import { Injectable } from '@nestjs/common';

export type VoiceParticipant = {
  userId: string;
  displayName: string;
};

type VoicePresenceRecord = VoiceParticipant & {
  channelId: string;
  spaceId: string;
};

@Injectable()
export class VoicePresenceService {
  private readonly connections = new Map<string, VoicePresenceRecord>();

  join(
    socketId: string,
    record: VoicePresenceRecord,
  ): { previous?: VoicePresenceRecord; current: VoicePresenceRecord } {
    const previous = this.connections.get(socketId);
    this.connections.set(socketId, record);
    return { previous, current: record };
  }

  leave(socketId: string, expectedChannelId?: string) {
    const current = this.connections.get(socketId);
    if (
      !current ||
      (expectedChannelId && current.channelId !== expectedChannelId)
    ) {
      return undefined;
    }
    this.connections.delete(socketId);
    return current;
  }

  current(socketId: string) {
    return this.connections.get(socketId);
  }

  participants(channelId: string): VoiceParticipant[] {
    const unique = new Map<string, VoiceParticipant>();
    for (const connection of this.connections.values()) {
      if (connection.channelId !== channelId) continue;
      unique.set(connection.userId, {
        userId: connection.userId,
        displayName: connection.displayName,
      });
    }
    return [...unique.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName, 'pt-BR'),
    );
  }

  snapshot(channelIds: string[]) {
    const channels = new Set<string>();
    for (const connection of this.connections.values()) {
      if (channelIds.includes(connection.channelId)) {
        channels.add(connection.channelId);
      }
    }
    return [...channels].map((channelId) => ({
      channelId,
      participants: this.participants(channelId),
    }));
  }
}
