import { ForbiddenException, OnModuleDestroy } from '@nestjs/common';
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
import { ChatService, type ChatMessage } from './chat.service';
import { SessionRegistry } from './session.registry';
import { SpacesService } from './spaces.service';
import { VoicePresenceService } from './voice-presence.service';
import { websocketOriginAllowed } from './environment';

type AuthenticatedSocketData = {
  user?: AuthUser;
  sessionId?: string;
};

@WebSocketGateway({
  cors: {
    credentials: true,
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void,
    ) => {
      if (websocketOriginAllowed(origin)) callback(null, true);
      else callback(new Error('Origem não autorizada.'));
    },
  },
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

  private unsubscribeSessions?: () => void;

  constructor(
    private readonly auth: AuthService,
    private readonly chat: ChatService,
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
    if (previous) this.broadcastVoiceChannel(previous.channelId);
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
        this.broadcastVoiceChannel(change.previous.channelId);
      }
      this.broadcastVoiceChannel(channel.id);
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
    if (previous) this.broadcastVoiceChannel(previous.channelId);
  }

  @SubscribeMessage('chat:join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string },
  ) {
    const user = (client.data as AuthenticatedSocketData).user;
    if (!user) {
      client.emit('chat:error', {
        message: 'Você não tem acesso a este canal.',
      });
      return;
    }
    try {
      const history = await this.chat.history(user.id, payload.channelId);
      for (const room of client.rooms) {
        if (room.startsWith('channel:')) await client.leave(room);
      }
      await client.join(`channel:${payload.channelId}`);
      client.emit('chat:history', history);
    } catch (error) {
      client.emit('chat:error', {
        message:
          error instanceof ForbiddenException
            ? error.message
            : 'Não foi possível carregar as mensagens deste canal.',
      });
    }
  }

  @SubscribeMessage('chat:send')
  async send(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Pick<ChatMessage, 'channelId' | 'body'>,
  ) {
    const user = (client.data as AuthenticatedSocketData).user;
    if (!user) {
      client.emit('chat:error', {
        message: 'Você não tem acesso a este canal.',
      });
      return;
    }
    try {
      const message = await this.chat.create(user.id, payload);
      if (!message) return;
      this.server
        .to(`channel:${payload.channelId}`)
        .emit('chat:message', message);
    } catch (error) {
      client.emit('chat:error', {
        message:
          error instanceof ForbiddenException
            ? error.message
            : 'Não foi possível enviar a mensagem.',
      });
    }
  }

  private async syncSpaceRooms(client: Socket, userId: string) {
    const [spaceIds, channelIds] = await Promise.all([
      this.spaces.spaceIdsForUser(userId),
      this.spaces.channelIdsForUser(userId),
    ]);
    for (const room of client.rooms) {
      if (room.startsWith('space:')) await client.leave(room);
      if (room.startsWith('presence-channel:')) await client.leave(room);
    }
    for (const spaceId of spaceIds) {
      await client.join(`space:${spaceId}`);
    }
    for (const channelId of channelIds) {
      await client.join(`presence-channel:${channelId}`);
    }
    client.emit(
      'voice:presence:snapshot',
      this.voicePresence.snapshot(channelIds),
    );
  }

  private broadcastVoiceChannel(channelId: string) {
    this.server.to(`presence-channel:${channelId}`).emit('voice:presence', {
      channelId,
      participants: this.voicePresence.participants(channelId),
    });
  }
}
