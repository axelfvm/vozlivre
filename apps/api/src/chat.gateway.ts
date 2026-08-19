import { OnModuleDestroy } from '@nestjs/common';
import { ChannelKind } from '@prisma/client';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { SessionRegistry } from './session.registry';
import { SpacesService } from './spaces.service';
import { VoicePresenceService } from './voice-presence.service';

type ChatMessage = {
  id: string;
  channelId: string;
  author: string;
  body: string;
  createdAt: string;
};

type AuthenticatedSocketData = {
  user?: AuthUser;
  sessionId?: string;
};

@WebSocketGateway({
  cors: { origin: 'http://localhost:5173', credentials: true },
})
export class ChatGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly messages: ChatMessage[] = [];

  private unsubscribeSessions?: () => void;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionRegistry,
    private readonly spaces: SpacesService,
    private readonly voicePresence: VoicePresenceService,
  ) {}

  afterInit() {
    this.unsubscribeSessions = this.sessions.subscribe((userId, message) => {
      const room = `user:${userId}`;
      this.server.to(room).emit('auth:error', { message });
      this.server.in(room).disconnectSockets(true);
    });
  }

  onModuleDestroy() {
    this.unsubscribeSessions?.();
  }

  async handleConnection(client: Socket) {
    const cookieHeader = client.handshake.headers.cookie ?? '';
    const token = cookieHeader
      .split(';')
      .map((part) => part.trim().split('='))
      .find(([key]) => key === 'vozlivre_session')?.[1];
    const session = await this.auth.sessionFromToken(token);
    if (!session) {
      client.emit('auth:error', { message: 'Sessão inválida.' });
      client.disconnect(true);
      return;
    }
    const data = client.data as AuthenticatedSocketData;
    data.user = session.user;
    data.sessionId = session.sessionId;
    await client.join(`user:${session.user.id}`);
    await this.syncSpaceRooms(client, session.user.id);
    client.emit('chat:ready', { online: this.server.engine.clientsCount });
  }

  handleDisconnect(client: Socket) {
    const previous = this.voicePresence.leave(client.id);
    if (previous)
      this.broadcastVoiceChannel(previous.spaceId, previous.channelId);
  }

  @SubscribeMessage('spaces:sync')
  async syncSpaces(@ConnectedSocket() client: Socket) {
    const user = (client.data as AuthenticatedSocketData).user;
    if (!user) return;
    await this.syncSpaceRooms(client, user.id);
  }

  @SubscribeMessage('voice:join')
  async joinVoice(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string },
  ) {
    const user = (client.data as AuthenticatedSocketData).user;
    if (!user) return;
    try {
      const channel = await this.spaces.accessibleChannel(
        user.id,
        payload.channelId,
        ChannelKind.VOICE,
      );
      const change = this.voicePresence.join(client.id, {
        channelId: channel.id,
        spaceId: channel.spaceId,
        userId: user.id,
        displayName: user.displayName,
      });
      if (
        change.previous &&
        change.previous.channelId !== change.current.channelId
      ) {
        this.broadcastVoiceChannel(
          change.previous.spaceId,
          change.previous.channelId,
        );
      }
      this.broadcastVoiceChannel(channel.spaceId, channel.id);
    } catch {
      client.emit('voice:error', {
        message: 'Você não tem acesso a este canal de voz.',
      });
    }
  }

  @SubscribeMessage('voice:leave')
  leaveVoice(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId?: string },
  ) {
    const previous = this.voicePresence.leave(client.id, payload.channelId);
    if (previous)
      this.broadcastVoiceChannel(previous.spaceId, previous.channelId);
  }

  @SubscribeMessage('chat:join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string },
  ) {
    const user = (client.data as AuthenticatedSocketData).user;
    if (
      !user ||
      !(await this.spaces.canAccessChannel(user.id, payload.channelId))
    ) {
      client.emit('chat:error', {
        message: 'Você não tem acesso a este canal.',
      });
      return;
    }
    for (const room of client.rooms) {
      if (room.startsWith('channel:')) await client.leave(room);
    }
    await client.join(`channel:${payload.channelId}`);
    if (
      !this.messages.some((message) => message.channelId === payload.channelId)
    ) {
      this.messages.push({
        id: `welcome-${payload.channelId}`,
        channelId: payload.channelId,
        author: 'VozLivre',
        body: 'Este é o começo deste canal privado.',
        createdAt: new Date().toISOString(),
      });
    }
    client.emit(
      'chat:history',
      this.messages.filter(
        (message) => message.channelId === payload.channelId,
      ),
    );
  }

  @SubscribeMessage('chat:send')
  async send(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Pick<ChatMessage, 'channelId' | 'body'>,
  ) {
    const user = (client.data as AuthenticatedSocketData).user;
    if (
      !user ||
      !(await this.spaces.canAccessChannel(user.id, payload.channelId))
    ) {
      client.emit('chat:error', {
        message: 'Você não tem acesso a este canal.',
      });
      return;
    }
    const body = payload.body.trim().slice(0, 4000);
    if (!body) return;

    const message: ChatMessage = {
      channelId: payload.channelId,
      author: user.displayName,
      body,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.messages.push(message);
    this.server
      .to(`channel:${payload.channelId}`)
      .emit('chat:message', message);
  }

  private async syncSpaceRooms(client: Socket, userId: string) {
    const spaceIds = await this.spaces.spaceIdsForUser(userId);
    for (const room of client.rooms) {
      if (room.startsWith('space:')) await client.leave(room);
    }
    for (const spaceId of spaceIds) {
      await client.join(`space:${spaceId}`);
    }
    client.emit(
      'voice:presence:snapshot',
      this.voicePresence.snapshot(spaceIds),
    );
  }

  private broadcastVoiceChannel(spaceId: string, channelId: string) {
    this.server.to(`space:${spaceId}`).emit('voice:presence', {
      channelId,
      participants: this.voicePresence.participants(channelId),
    });
  }
}
