import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChannelKind } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { SpacesService } from './spaces.service';

export type ChatMessage = {
  id: string;
  channelId: string;
  authorId: string;
  author: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  replyTo: { id: string; author: string; body: string } | null;
  reactions: { emoji: string; count: number; userIds: string[] }[];
};

type PersistedMessage = {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  author: { displayName: string };
  replyTo: { id: string; body: string; author: { displayName: string } } | null;
  reactions: { emoji: string; userId: string }[];
};

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
  ) {}

  async history(userId: string, channelId: string, beforeId?: string) {
    await this.spaces.accessibleChannel(userId, channelId, ChannelKind.TEXT);
    const messages = await this.prisma.message.findMany({
      where: { channelId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      ...(beforeId ? { cursor: { id: beforeId }, skip: 1 } : {}),
      select: this.messageSelect,
    });
    return {
      messages: messages
        .slice(0, 50)
        .reverse()
        .map((message) => this.toChatMessage(message)),
      hasMore: messages.length > 50,
    };
  }

  async create(
    userId: string,
    input: { channelId: string; body: unknown; replyToId?: unknown },
  ): Promise<ChatMessage | null> {
    await this.spaces.accessibleChannel(
      userId,
      input.channelId,
      ChannelKind.TEXT,
    );
    if (typeof input.body !== 'string') return null;
    const body = input.body.trim().slice(0, 4000);
    if (!body) return null;
    const replyToId =
      typeof input.replyToId === 'string' && input.replyToId
        ? input.replyToId
        : undefined;
    if (replyToId) {
      const reply = await this.prisma.message.findFirst({
        where: { id: replyToId, channelId: input.channelId },
        select: { id: true },
      });
      if (!reply)
        throw new NotFoundException('Mensagem respondida não existe.');
    }
    const message = await this.prisma.message.create({
      data: { channelId: input.channelId, authorId: userId, body, replyToId },
      select: this.messageSelect,
    });
    return this.toChatMessage(message);
  }

  async edit(userId: string, messageId: string, bodyInput: unknown) {
    const existing = await this.requireMessage(userId, messageId);
    if (existing.authorId !== userId)
      throw new ForbiddenException('Você só pode editar suas mensagens.');
    if (typeof bodyInput !== 'string' || !bodyInput.trim())
      throw new NotFoundException('A mensagem não pode ficar vazia.');
    const message = await this.prisma.message.update({
      where: { id: messageId },
      data: { body: bodyInput.trim().slice(0, 4000), editedAt: new Date() },
      select: this.messageSelect,
    });
    return this.toChatMessage(message);
  }

  async delete(userId: string, messageId: string) {
    const message = await this.requireMessage(userId, messageId);
    if (
      message.authorId !== userId &&
      !(await this.spaces.canManageSpace(userId, message.channel.spaceId))
    ) {
      throw new ForbiddenException('Você não pode excluir esta mensagem.');
    }
    await this.prisma.message.delete({ where: { id: messageId } });
    return { id: messageId, channelId: message.channelId };
  }

  async toggleReaction(userId: string, messageId: string, emojiInput: unknown) {
    const message = await this.requireMessage(userId, messageId);
    if (typeof emojiInput !== 'string')
      throw new NotFoundException('Reação inválida.');
    const emoji = emojiInput.trim().slice(0, 32);
    if (!['👍', '❤️', '😂', '🎉', '👀', '✅'].includes(emoji))
      throw new NotFoundException('Reação inválida.');
    const where = { messageId_userId_emoji: { messageId, userId, emoji } };
    const existing = await this.prisma.messageReaction.findUnique({ where });
    if (existing) await this.prisma.messageReaction.delete({ where });
    else
      await this.prisma.messageReaction.create({
        data: { messageId, userId, emoji },
      });
    const updated = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      select: this.messageSelect,
    });
    return {
      channelId: message.channelId,
      message: this.toChatMessage(updated),
    };
  }

  private requireMessage(userId: string, messageId: string) {
    return this.prisma.message
      .findUnique({
        where: { id: messageId },
        select: {
          authorId: true,
          channelId: true,
          channel: { select: { spaceId: true } },
        },
      })
      .then(async (message) => {
        if (!message) throw new NotFoundException('Mensagem não encontrada.');
        await this.spaces.accessibleChannel(
          userId,
          message.channelId,
          ChannelKind.TEXT,
        );
        return message;
      });
  }

  private toChatMessage(message: PersistedMessage): ChatMessage {
    const reactions = new Map<
      string,
      { emoji: string; count: number; userIds: string[] }
    >();
    for (const reaction of message.reactions) {
      const aggregate = reactions.get(reaction.emoji) ?? {
        emoji: reaction.emoji,
        count: 0,
        userIds: [],
      };
      aggregate.count += 1;
      aggregate.userIds.push(reaction.userId);
      reactions.set(reaction.emoji, aggregate);
    }
    return {
      id: message.id,
      channelId: message.channelId,
      authorId: message.authorId,
      author: message.author.displayName,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            author: message.replyTo.author.displayName,
            body: message.replyTo.body,
          }
        : null,
      reactions: [...reactions.values()],
    };
  }

  private readonly messageSelect = {
    id: true,
    channelId: true,
    authorId: true,
    body: true,
    createdAt: true,
    editedAt: true,
    author: { select: { displayName: true } },
    replyTo: {
      select: {
        id: true,
        body: true,
        author: { select: { displayName: true } },
      },
    },
    reactions: { select: { emoji: true, userId: true } },
  } as const;
}
