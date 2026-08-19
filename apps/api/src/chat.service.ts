import { Injectable } from '@nestjs/common';
import { ChannelKind } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { SpacesService } from './spaces.service';

export type ChatMessage = {
  id: string;
  channelId: string;
  author: string;
  body: string;
  createdAt: string;
};

type PersistedMessage = {
  id: string;
  channelId: string;
  body: string;
  createdAt: Date;
  author: { displayName: string };
};

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
  ) {}

  async history(userId: string, channelId: string): Promise<ChatMessage[]> {
    await this.spaces.accessibleChannel(userId, channelId, ChannelKind.TEXT);

    const messages = await this.prisma.message.findMany({
      where: { channelId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        channelId: true,
        body: true,
        createdAt: true,
        author: { select: { displayName: true } },
      },
    });

    return messages.map((message) => this.toChatMessage(message));
  }

  async create(
    userId: string,
    input: { channelId: string; body: unknown },
  ): Promise<ChatMessage | null> {
    await this.spaces.accessibleChannel(
      userId,
      input.channelId,
      ChannelKind.TEXT,
    );

    if (typeof input.body !== 'string') return null;
    const body = input.body.trim().slice(0, 4000);
    if (!body) return null;

    const message = await this.prisma.message.create({
      data: {
        channelId: input.channelId,
        authorId: userId,
        body,
      },
      select: {
        id: true,
        channelId: true,
        body: true,
        createdAt: true,
        author: { select: { displayName: true } },
      },
    });

    return this.toChatMessage(message);
  }

  private toChatMessage(message: PersistedMessage): ChatMessage {
    return {
      id: message.id,
      channelId: message.channelId,
      author: message.author.displayName,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
