import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChannelKind, MentionKind, SpaceKind } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { SpacesService } from './spaces.service';
import { MediaService } from './media.service';
import { ChatEventRegistry } from './chat-event.registry';

export type ChatMessage = {
  id: string;
  channelId: string;
  authorId: string;
  author: string;
  authorAvatarUrl: string | null;
  body: string;
  pinnedAt: string | null;
  createdAt: string;
  editedAt: string | null;
  replyTo: { id: string; author: string; body: string } | null;
  reactions: { emoji: string; count: number; userIds: string[] }[];
  attachments: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    url: string;
  }[];
  mentions: { kind: MentionKind; targetId: string }[];
  sticker: {
    id: string;
    name: string;
    url: string;
  } | null;
  gif: {
    provider: 'GIPHY';
    externalId: string;
    url: string;
    title: string;
    altText: string;
    username: string | null;
    pageUrl: string | null;
  } | null;
  thread: {
    id: string;
    title: string;
    archivedAt: string | null;
    messageCount: number;
  } | null;
};

type PersistedMessage = {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  pinnedAt: Date | null;
  createdAt: Date;
  editedAt: Date | null;
  author: { displayName: string; avatarUrl: string | null };
  replyTo: {
    id: string;
    body: string;
    gifTitle: string | null;
    author: { displayName: string };
  } | null;
  reactions: { emoji: string; userId: string }[];
  attachments: {
    id: string;
    originalName: string;
    storedName: string;
    mimeType: string;
    size: number;
  }[];
  mentions: { kind: MentionKind; targetId: string }[];
  sticker: { id: string; name: string; storedName: string } | null;
  gifProvider: string | null;
  gifExternalId: string | null;
  gifUrl: string | null;
  gifTitle: string | null;
  gifAltText: string | null;
  gifUsername: string | null;
  gifPageUrl: string | null;
  thread: {
    id: string;
    topic: string;
    archivedAt: Date | null;
    _count: { messages: number };
  } | null;
};

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly media: MediaService,
    private readonly events: ChatEventRegistry,
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
    await this.markRead(userId, channelId);
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
    input: {
      channelId: string;
      body: unknown;
      replyToId?: unknown;
      attachmentIds?: unknown;
      stickerId?: unknown;
      gif?: unknown;
    },
  ): Promise<ChatMessage | null> {
    const channel = await this.spaces.accessibleChannel(
      userId,
      input.channelId,
      ChannelKind.TEXT,
    );
    if (
      !(await this.spaces.hasPermission(
        userId,
        channel.spaceId,
        'SEND_MESSAGES',
      ))
    )
      throw new ForbiddenException(
        'Você não pode enviar mensagens neste canal.',
      );
    await this.requireDirectCommunication(userId, channel.spaceId);
    if (channel.archivedAt)
      throw new ForbiddenException('Esta thread está arquivada.');
    const body =
      typeof input.body === 'string' ? input.body.trim().slice(0, 4000) : '';
    const attachmentIds = Array.isArray(input.attachmentIds)
      ? [
          ...new Set(
            input.attachmentIds.filter(
              (value): value is string => typeof value === 'string',
            ),
          ),
        ].slice(0, 10)
      : [];
    const stickerId =
      typeof input.stickerId === 'string' && input.stickerId
        ? input.stickerId
        : undefined;
    const gif = this.parseGif(input.gif);
    if (!body && !attachmentIds.length && !stickerId && !gif) return null;
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
    if (attachmentIds.length) {
      const validAttachments = await this.prisma.messageAttachment.count({
        where: {
          id: { in: attachmentIds },
          uploaderId: userId,
          messageId: null,
        },
      });
      if (validAttachments !== attachmentIds.length)
        throw new ForbiddenException('Um dos anexos não é válido.');
    }
    if (stickerId) {
      const sticker = await this.prisma.spaceSticker.findFirst({
        where: { id: stickerId, spaceId: channel.spaceId },
        select: { id: true },
      });
      if (!sticker) throw new NotFoundException('Figurinha não encontrada.');
    }
    const mentions = await this.parseMentions(userId, channel.spaceId, body);
    const message =
      attachmentIds.length || mentions.length || stickerId
        ? await this.prisma.$transaction(async (transaction) => {
            const created = await transaction.message.create({
              data: {
                channelId: input.channelId,
                authorId: userId,
                body,
                replyToId,
                stickerId,
                ...gif,
                mentions: mentions.length
                  ? { createMany: { data: mentions } }
                  : undefined,
              },
              select: { id: true },
            });
            if (attachmentIds.length)
              await transaction.messageAttachment.updateMany({
                where: {
                  id: { in: attachmentIds },
                  uploaderId: userId,
                  messageId: null,
                },
                data: { messageId: created.id },
              });
            return transaction.message.findUniqueOrThrow({
              where: { id: created.id },
              select: this.messageSelect,
            });
          })
        : await this.prisma.message.create({
            data: {
              channelId: input.channelId,
              authorId: userId,
              body,
              replyToId,
              ...gif,
            },
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
    const body = bodyInput.trim().slice(0, 4000);
    const mentions = await this.parseMentions(
      userId,
      existing.channel.spaceId,
      body,
    );
    const message = await this.prisma.$transaction(async (transaction) => {
      await transaction.messageMention.deleteMany({ where: { messageId } });
      await transaction.message.update({
        where: { id: messageId },
        data: {
          body,
          editedAt: new Date(),
          mentions: mentions.length
            ? { createMany: { data: mentions } }
            : undefined,
        },
      });
      return transaction.message.findUniqueOrThrow({
        where: { id: messageId },
        select: this.messageSelect,
      });
    });
    return this.toChatMessage(message);
  }

  async delete(userId: string, messageId: string) {
    const message = await this.requireMessage(userId, messageId);
    if (
      message.authorId !== userId &&
      !(await this.spaces.hasPermission(
        userId,
        message.channel.spaceId,
        'MANAGE_MESSAGES',
      ))
    ) {
      throw new ForbiddenException('Você não pode excluir esta mensagem.');
    }
    const attachments = await this.prisma.messageAttachment.findMany({
      where: { messageId },
      select: { storedName: true },
    });
    await this.prisma.message.delete({ where: { id: messageId } });
    await this.media.removeMany(attachments.map((item) => item.storedName));
    return { id: messageId, channelId: message.channelId };
  }

  async search(userId: string, channelId: string, queryInput: string) {
    await this.spaces.accessibleChannel(userId, channelId, ChannelKind.TEXT);
    const query = queryInput.trim().slice(0, 100);
    if (query.length < 2) return [];
    const messages = await this.prisma.message.findMany({
      where: {
        channelId,
        OR: [
          { body: { contains: query, mode: 'insensitive' } },
          { gifTitle: { contains: query, mode: 'insensitive' } },
          { gifUsername: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: this.messageSelect,
    });
    return messages.map((message) => this.toChatMessage(message));
  }

  async pins(userId: string, channelId: string) {
    await this.spaces.accessibleChannel(userId, channelId, ChannelKind.TEXT);
    const messages = await this.prisma.message.findMany({
      where: { channelId, pinnedAt: { not: null } },
      orderBy: { pinnedAt: 'desc' },
      take: 50,
      select: this.messageSelect,
    });
    return messages.map((message) => this.toChatMessage(message));
  }

  async setPinned(userId: string, messageId: string, pinned: boolean) {
    const existing = await this.requireMessage(userId, messageId);
    if (
      !(await this.spaces.hasPermission(
        userId,
        existing.channel.spaceId,
        'MANAGE_MESSAGES',
      ))
    )
      throw new ForbiddenException('Você não pode fixar mensagens.');
    const message = await this.prisma.message.update({
      where: { id: messageId },
      data: { pinnedAt: pinned ? new Date() : null },
      select: this.messageSelect,
    });
    const result = this.toChatMessage(message);
    await this.events.notify(result.channelId, 'chat:message:update', result);
    return result;
  }

  async markRead(userId: string, channelId: string) {
    await this.spaces.accessibleChannel(userId, channelId, ChannelKind.TEXT);
    await this.prisma.channelReadState.upsert({
      where: { userId_channelId: { userId, channelId } },
      update: { lastReadAt: new Date() },
      create: { userId, channelId, lastReadAt: new Date() },
    });
    return { ok: true };
  }

  async registerAttachment(
    userId: string,
    channelId: string,
    file: Express.Multer.File,
  ) {
    try {
      const channel = await this.spaces.accessibleChannel(
        userId,
        channelId,
        ChannelKind.TEXT,
      );
      if (
        !(await this.spaces.hasPermission(
          userId,
          channel.spaceId,
          'ATTACH_FILES',
        ))
      )
        throw new ForbiddenException(
          'Você não pode anexar arquivos neste canal.',
        );
      await this.requireDirectCommunication(userId, channel.spaceId);
      const attachment = await this.prisma.messageAttachment.create({
        data: {
          uploaderId: userId,
          originalName: file.originalname.slice(0, 255),
          storedName: file.filename,
          mimeType: file.mimetype.slice(0, 120),
          size: file.size,
        },
        select: {
          id: true,
          originalName: true,
          storedName: true,
          mimeType: true,
          size: true,
        },
      });
      return {
        id: attachment.id,
        name: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        url: `/uploads/${attachment.storedName}`,
      };
    } catch (error) {
      await this.media.remove(file.filename);
      throw error;
    }
  }

  async cancelAttachment(userId: string, attachmentId: string) {
    const attachment = await this.prisma.messageAttachment.findFirst({
      where: { id: attachmentId, uploaderId: userId, messageId: null },
      select: { id: true, storedName: true },
    });
    if (!attachment) throw new NotFoundException('Anexo não encontrado.');
    await this.prisma.messageAttachment.delete({
      where: { id: attachment.id },
    });
    await this.media.remove(attachment.storedName);
    return { ok: true };
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
      authorAvatarUrl: message.author.avatarUrl ?? null,
      body: message.body,
      pinnedAt: message.pinnedAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            author: message.replyTo.author.displayName,
            body:
              message.replyTo.body ||
              (message.replyTo.gifTitle
                ? `GIF: ${message.replyTo.gifTitle}`
                : 'Mensagem com mídia'),
          }
        : null,
      reactions: [...reactions.values()],
      attachments: (message.attachments ?? []).map((attachment) => ({
        id: attachment.id,
        name: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        url: `/uploads/${attachment.storedName}`,
      })),
      mentions: message.mentions ?? [],
      sticker: message.sticker
        ? {
            id: message.sticker.id,
            name: message.sticker.name,
            url: `/uploads/${message.sticker.storedName}`,
          }
        : null,
      gif:
        message.gifProvider === 'GIPHY' &&
        message.gifExternalId &&
        message.gifUrl
          ? {
              provider: 'GIPHY',
              externalId: message.gifExternalId,
              url: message.gifUrl,
              title: message.gifTitle || 'GIF do GIPHY',
              altText: message.gifAltText || message.gifTitle || 'GIF do GIPHY',
              username: message.gifUsername || null,
              pageUrl: message.gifPageUrl || null,
            }
          : null,
      thread: message.thread
        ? {
            id: message.thread.id,
            title: message.thread.topic,
            archivedAt: message.thread.archivedAt?.toISOString() ?? null,
            messageCount: message.thread._count.messages,
          }
        : null,
    };
  }

  private parseGif(input: unknown) {
    if (input === undefined || input === null) return undefined;
    if (typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException('GIF inválido.');
    const value = input as Record<string, unknown>;
    if (value.provider !== 'GIPHY')
      throw new BadRequestException('Provedor de GIF não permitido.');
    const externalId =
      typeof value.externalId === 'string' ? value.externalId.trim() : '';
    const url = typeof value.url === 'string' ? value.url.trim() : '';
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(externalId))
      throw new BadRequestException('Identificador do GIF inválido.');
    if (!this.isGiphyMediaUrl(url))
      throw new BadRequestException('URL de mídia do GIPHY inválida.');
    const pageUrl =
      typeof value.pageUrl === 'string' && value.pageUrl.trim()
        ? value.pageUrl.trim()
        : null;
    if (pageUrl && !this.isGiphyPageUrl(pageUrl))
      throw new BadRequestException('Página do GIF inválida.');
    const title =
      typeof value.title === 'string' && value.title.trim()
        ? value.title.trim().slice(0, 180)
        : 'GIF do GIPHY';
    const altText =
      typeof value.altText === 'string' && value.altText.trim()
        ? value.altText.trim().slice(0, 500)
        : title;
    const username =
      typeof value.username === 'string' && value.username.trim()
        ? value.username.trim().slice(0, 100)
        : null;
    return {
      gifProvider: 'GIPHY',
      gifExternalId: externalId,
      gifUrl: url,
      gifTitle: title,
      gifAltText: altText,
      gifUsername: username,
      gifPageUrl: pageUrl,
    };
  }

  private isGiphyMediaUrl(value: string) {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        /^(?:media\d*|i)\.giphy\.com$/i.test(url.hostname)
      );
    } catch {
      return false;
    }
  }

  private isGiphyPageUrl(value: string) {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        /^(?:www\.)?giphy\.com$/i.test(url.hostname)
      );
    } catch {
      return false;
    }
  }

  private async parseMentions(userId: string, spaceId: string, body: string) {
    const userIds = [
      ...new Set(
        [...body.matchAll(/<@([a-zA-Z0-9_-]+)>/g)].map((match) => match[1]),
      ),
    ];
    const roleIds = [
      ...new Set(
        [...body.matchAll(/<@&([a-zA-Z0-9_-]+)>/g)].map((match) => match[1]),
      ),
    ];
    const [validUsers, validRoles] = await Promise.all([
      userIds.length
        ? this.prisma.membership.findMany({
            where: { spaceId, userId: { in: userIds } },
            select: { userId: true },
          })
        : [],
      roleIds.length
        ? this.prisma.spaceRole.findMany({
            where: { spaceId, id: { in: roleIds } },
            select: { id: true },
          })
        : [],
    ]);
    const mentions: { kind: MentionKind; targetId: string }[] = [
      ...validUsers.map((item) => ({
        kind: MentionKind.USER,
        targetId: item.userId,
      })),
      ...validRoles.map((item) => ({
        kind: MentionKind.ROLE,
        targetId: item.id,
      })),
    ];
    if (
      /(^|\s)@everyone\b/i.test(body) &&
      (await this.spaces.hasPermission(userId, spaceId, 'MENTION_EVERYONE'))
    )
      mentions.push({ kind: MentionKind.EVERYONE, targetId: '' });
    return mentions;
  }

  private async requireDirectCommunication(userId: string, spaceId: string) {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: {
        kind: true,
        memberships: { select: { userId: true } },
      },
    });
    if (space?.kind !== SpaceKind.DIRECT) return;
    const otherId = space.memberships.find(
      (membership) => membership.userId !== userId,
    )?.userId;
    if (!otherId) throw new ForbiddenException('Conversa indisponível.');
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: otherId },
          { blockerId: otherId, blockedId: userId },
        ],
      },
      select: { blockerId: true },
    });
    if (blocked)
      throw new ForbiddenException(
        'Não é possível enviar mensagens nesta conversa.',
      );
  }

  private readonly messageSelect = {
    id: true,
    channelId: true,
    authorId: true,
    body: true,
    gifProvider: true,
    gifExternalId: true,
    gifUrl: true,
    gifTitle: true,
    gifAltText: true,
    gifUsername: true,
    gifPageUrl: true,
    pinnedAt: true,
    createdAt: true,
    editedAt: true,
    author: { select: { displayName: true, avatarUrl: true } },
    replyTo: {
      select: {
        id: true,
        body: true,
        gifTitle: true,
        author: { select: { displayName: true } },
      },
    },
    reactions: { select: { emoji: true, userId: true } },
    attachments: {
      select: {
        id: true,
        originalName: true,
        storedName: true,
        mimeType: true,
        size: true,
      },
    },
    mentions: { select: { kind: true, targetId: true } },
    sticker: { select: { id: true, name: true, storedName: true } },
    thread: {
      select: {
        id: true,
        topic: true,
        archivedAt: true,
        _count: { select: { messages: true } },
      },
    },
  } as const;
}
