import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RoomServiceClient } from 'livekit-server-sdk';
import { ConfigService } from '@nestjs/config';
import { SessionRegistry } from './session.registry';

@Injectable()
export class MediaSessionCleaner implements OnModuleInit, OnModuleDestroy {
  private readonly roomService: RoomServiceClient;
  private unsubscribeSessions?: () => void;

  constructor(
    private readonly sessions: SessionRegistry,
    config: ConfigService,
  ) {
    const livekitUrl = config
      .getOrThrow<string>('LIVEKIT_URL')
      .replace(/^wss:/, 'https:')
      .replace(/^ws:/, 'http:');
    this.roomService = new RoomServiceClient(
      livekitUrl,
      config.getOrThrow<string>('LIVEKIT_API_KEY'),
      config.getOrThrow<string>('LIVEKIT_API_SECRET'),
    );
  }

  onModuleInit() {
    this.unsubscribeSessions = this.sessions.subscribe((userId) =>
      this.disconnectParticipant(userId),
    );
  }

  onModuleDestroy() {
    this.unsubscribeSessions?.();
  }

  async disconnectFromChannel(userId: string, channelId: string) {
    try {
      const roomName = `vozlivre-channel-${channelId}`;
      const participants = await this.roomService.listParticipants(roomName);
      await Promise.allSettled(
        participants
          .filter(
            (participant) =>
              participant.identity === userId ||
              participant.identity.startsWith(`${userId}:`),
          )
          .map((participant) =>
            this.roomService.removeParticipant(roomName, participant.identity),
          ),
      );
    } catch {
      // The authorization database remains authoritative if media is offline.
    }
  }

  private async disconnectParticipant(userId: string) {
    try {
      const rooms = await this.roomService.listRooms();
      const revokeTokenTs = BigInt(Math.floor(Date.now() / 1000) + 1);
      await Promise.allSettled(
        rooms.map(async (room) => {
          const participants = await this.roomService.listParticipants(
            room.name,
          );
          const previousSessions = participants.filter(
            (participant) =>
              participant.identity === userId ||
              participant.identity.startsWith(`${userId}:`),
          );
          await Promise.allSettled(
            previousSessions.map((participant) =>
              this.roomService.removeParticipant(
                room.name,
                participant.identity,
                { revokeTokenTs },
              ),
            ),
          );
        }),
      );
    } catch {
      // Session validation in PostgreSQL remains authoritative if media is offline.
    }
  }
}
