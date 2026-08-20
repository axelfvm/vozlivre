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
import { websocketOriginAllowed } from './environment';
import { SpaceChangeRegistry } from './space-change.registry';
import { MediaSessionCleaner } from './media-session-cleaner';
import { ChatEventRegistry } from './chat-event.registry';

type AuthenticatedSocketData = {
  user?: AuthUser;
  sessionId?: string;
  voicePresence?: VoicePresenceRecord;
};

type VoicePresenceRecord = {
  channelId: string;
  spaceId: string;
  userId: string;
  displayName: string;
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
  private unsubscribeSpaceChanges?: () => void;
  private unsubscribeChatEvents?: () => void;

  constructor(
    private readonly auth: AuthService,
    private readonly chat: ChatService,
    private readonly sessions: SessionRegistry,
    private readonly spaces: SpacesService,
    private readonly spaceChanges: SpaceChangeRegistry,
    private readonly mediaSessions: MediaSessionCleaner,
    private readonly chatEvents: ChatEventRegistry,
  ) {}

  afterInit() {
    this.server.use((socket, next) => {
      void this.authenticateSocket(socket)
        .then(() => next())
        .catch((error: unknown) =>
          next(
            new Error(
              error instanceof Error ? error.message : 'Sessão inválida.',
            ),
          ),
        );
    });
    this.unsubscribeSessions = this.sessions.subscribe((userId, message) => {
      const room = `user:${userId}`;
      this.server.to(room).emit('auth:error', { message });
      this.server.in(room).disconnectSockets(true);
    });
    this.unsubscribeSpaceChanges = this.spaceChanges.subscribe((spaceId) => {
      // The Redis adapter distributes this broadcast to every API replica.
      // Broadcasting globally also reaches users who have just been added.
      this.server.emit('spaces:changed', { spaceId });
    });
    this.unsubscribeChatEvents = this.chatEvents.subscribe(
      (channelId, event, payload) => {
        this.server.to(`updates-channel:${channelId}`).emit(event, payload);
      },
    );
  }

  onModuleDestroy() {
    this.unsubscribeSessions?.();
    this.unsubscribeSpaceChanges?.();
    this.unsubscribeChatEvents?.();
  }

  async handleConnection(client: Socket) {
    const data = client.data as AuthenticatedSocketData;
    const user = data.user;
    if (!user) {
      client.disconnect(true);
      return;
    }
    await client.join(`user:${user.id}`);
    await this.syncSpaceRooms(client, user.id);
    client.emit('chat:ready', { online: this.server.engine.clientsCount });
  }

  private async authenticateSocket(client: Socket) {
    const cookieHeader = client.handshake.headers.cookie ?? '';
    const token = cookieHeader
      .split(';')
      .map((part) => part.trim().split('='))
      .find(([key]) => key === 'vozlivre_session')?.[1];
    const session = await this.auth.sessionFromToken(token);
    if (!session) {
      throw new Error('Sessão inválida.');
    }
    const data = client.data as AuthenticatedSocketData;
    data.user = session.user;
    data.sessionId = session.sessionId;
  }

  async handleDisconnect(client: Socket) {
    const previous = (client.data as AuthenticatedSocketData).voicePresence;
    if (previous) await this.broadcastVoiceChannel(previous.channelId);
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
      const data = client.data as AuthenticatedSocketData;
      const previous = data.voicePresence;
      if (previous && previous.channelId !== channel.id) {
        await client.leave(`voice-channel:${previous.channelId}`);
      }
      data.voicePresence = {
        channelId: channel.id,
        spaceId: channel.spaceId,
        userId: user.id,
        displayName: user.displayName,
      };
      await client.join(`voice-channel:${channel.id}`);
      if (previous && previous.channelId !== channel.id) {
        await this.broadcastVoiceChannel(previous.channelId);
      }
      await this.broadcastVoiceChannel(channel.id);
    } catch {
      client.emit('voice:error', {
        message: 'Você não tem acesso a este canal de voz.',
      });
    }
  }

  @SubscribeMessage('voice:leave')
  async leaveVoice(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId?: string },
  ) {
    const data = client.data as AuthenticatedSocketData;
    const previous = data.voicePresence;
    if (
      !previous ||
      (payload.channelId && previous.channelId !== payload.channelId)
    ) {
      return;
    }
    delete data.voicePresence;
    await client.leave(`voice-channel:${previous.channelId}`);
    await this.broadcastVoiceChannel(previous.channelId);
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

  @SubscribeMessage('chat:history:more')
  async moreHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string; beforeId: string },
  ) {
    const user = (client.data as AuthenticatedSocketData).user;
    if (!user) return;
    try {
      client.emit(
        'chat:history:more',
        await this.chat.history(user.id, payload.channelId, payload.beforeId),
      );
    } catch {
      client.emit('chat:error', {
        message: 'Não foi possível carregar mensagens anteriores.',
      });
    }
  }

  @SubscribeMessage('chat:send')
  async send(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: Pick<ChatMessage, 'channelId' | 'body'> & {
      replyToId?: string;
      attachmentIds?: string[];
      stickerId?: string;
      gif?: unknown;
    },
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
        .to(`updates-channel:${payload.channelId}`)
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

  @SubscribeMessage('chat:typing')
  async typing(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string; typing: boolean },
  ) {
    const user = (client.data as AuthenticatedSocketData).user;
    if (!user) return;
    try {
      await this.spaces.accessibleChannel(
        user.id,
        payload.channelId,
        ChannelKind.TEXT,
      );
      client.to(`channel:${payload.channelId}`).emit('chat:typing', {
        channelId: payload.channelId,
        userId: user.id,
        displayName: user.displayName,
        typing: Boolean(payload.typing),
      });
    } catch {
      client.emit('chat:error', {
        message: 'Você não tem acesso a este canal.',
      });
    }
  }

  @SubscribeMessage('chat:edit')
  async editMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string; body: string },
  ) {
    const user = (client.data as AuthenticatedSocketData).user;
    if (!user) return;
    try {
      const message = await this.chat.edit(
        user.id,
        payload.messageId,
        payload.body,
      );
      this.server
        .to(`channel:${message.channelId}`)
        .to(`updates-channel:${message.channelId}`)
        .emit('chat:message:update', message);
    } catch (error) {
      client.emit('chat:error', {
        message:
          error instanceof Error
            ? error.message
            : 'Não foi possível editar a mensagem.',
      });
    }
  }

  @SubscribeMessage('chat:delete')
  async deleteMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string },
  ) {
    const user = (client.data as AuthenticatedSocketData).user;
    if (!user) return;
    try {
      const deleted = await this.chat.delete(user.id, payload.messageId);
      this.server
        .to(`channel:${deleted.channelId}`)
        .to(`updates-channel:${deleted.channelId}`)
        .emit('chat:message:delete', deleted);
    } catch (error) {
      client.emit('chat:error', {
        message:
          error instanceof Error
            ? error.message
            : 'Não foi possível excluir a mensagem.',
      });
    }
  }

  @SubscribeMessage('chat:reaction')
  async reactMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string; emoji: string },
  ) {
    const user = (client.data as AuthenticatedSocketData).user;
    if (!user) return;
    try {
      const update = await this.chat.toggleReaction(
        user.id,
        payload.messageId,
        payload.emoji,
      );
      this.server
        .to(`channel:${update.channelId}`)
        .to(`updates-channel:${update.channelId}`)
        .emit('chat:message:update', update.message);
    } catch (error) {
      client.emit('chat:error', {
        message:
          error instanceof Error
            ? error.message
            : 'Não foi possível reagir à mensagem.',
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
      if (room.startsWith('updates-channel:')) await client.leave(room);
      if (
        room.startsWith('channel:') &&
        !channelIds.includes(room.slice('channel:'.length))
      ) {
        await client.leave(room);
      }
    }
    for (const spaceId of spaceIds) {
      await client.join(`space:${spaceId}`);
    }
    for (const channelId of channelIds) {
      await client.join(`presence-channel:${channelId}`);
      await client.join(`updates-channel:${channelId}`);
    }
    const data = client.data as AuthenticatedSocketData;
    const presence = data.voicePresence;
    if (presence && !channelIds.includes(presence.channelId)) {
      delete data.voicePresence;
      await client.leave(`voice-channel:${presence.channelId}`);
      await this.mediaSessions.disconnectFromChannel(
        userId,
        presence.channelId,
      );
      client.emit('voice:error', {
        message: 'Seu acesso a este canal de voz foi removido.',
      });
      await this.broadcastVoiceChannel(presence.channelId);
    }
    client.emit(
      'voice:presence:snapshot',
      await this.voiceSnapshot(channelIds),
    );
  }

  private async broadcastVoiceChannel(channelId: string) {
    this.server.to(`presence-channel:${channelId}`).emit('voice:presence', {
      channelId,
      participants: await this.voiceParticipants(channelId),
    });
  }

  private async voiceParticipants(channelId: string) {
    const sockets = await this.server
      .in(`voice-channel:${channelId}`)
      .fetchSockets();
    const participants = new Map<
      string,
      { userId: string; displayName: string }
    >();
    for (const socket of sockets) {
      const presence = (socket.data as AuthenticatedSocketData).voicePresence;
      if (!presence || presence.channelId !== channelId) continue;
      participants.set(presence.userId, {
        userId: presence.userId,
        displayName: presence.displayName,
      });
    }
    return [...participants.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName, 'pt-BR'),
    );
  }

  private async voiceSnapshot(channelIds: string[]) {
    const snapshots = await Promise.all(
      channelIds.map(async (channelId) => ({
        channelId,
        participants: await this.voiceParticipants(channelId),
      })),
    );
    return snapshots.filter((snapshot) => snapshot.participants.length > 0);
  }
}
