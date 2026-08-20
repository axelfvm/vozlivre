import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChannelKind, Prisma } from '@prisma/client';
import { MediaService } from './media.service';
import { PrismaService } from './prisma.service';
import { SpaceChangeRegistry } from './space-change.registry';
import { SpacesService } from './spaces.service';
import { storedUploadName } from './uploads';

@Injectable()
export class CommunityFeaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly changes: SpaceChangeRegistry,
    private readonly media: MediaService,
  ) {}

  validateImage(file: Express.Multer.File) {
    return this.media.validateImage(file);
  }

  async createCategory(userId: string, spaceId: string, nameInput: string) {
    await this.requirePermission(userId, spaceId, 'MANAGE_CHANNELS');
    const name = this.normalizeName(nameInput, 50);
    if (!name) throw new ConflictException('Informe um nome para a categoria.');
    const last = await this.prisma.spaceCategory.findFirst({
      where: { spaceId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    try {
      const category = await this.prisma.spaceCategory.create({
        data: { spaceId, name, position: (last?.position ?? -1) + 1 },
      });
      await this.audit(
        userId,
        spaceId,
        'CATEGORY_CREATE',
        'category',
        category.id,
        {
          name,
        },
      );
      await this.changes.notify(spaceId);
      return category;
    } catch (error) {
      if (this.isUniqueConflict(error))
        throw new ConflictException('Já existe uma categoria com esse nome.');
      throw error;
    }
  }

  async updateCategory(
    userId: string,
    spaceId: string,
    categoryId: string,
    nameInput: string,
  ) {
    await this.requirePermission(userId, spaceId, 'MANAGE_CHANNELS');
    await this.requireCategory(spaceId, categoryId);
    const name = this.normalizeName(nameInput, 50);
    if (!name) throw new ConflictException('Informe um nome válido.');
    const category = await this.prisma.spaceCategory.update({
      where: { id: categoryId },
      data: { name },
    });
    await this.audit(
      userId,
      spaceId,
      'CATEGORY_UPDATE',
      'category',
      categoryId,
      {
        name,
      },
    );
    await this.changes.notify(spaceId);
    return category;
  }

  async deleteCategory(userId: string, spaceId: string, categoryId: string) {
    await this.requirePermission(userId, spaceId, 'MANAGE_CHANNELS');
    await this.requireCategory(spaceId, categoryId);
    await this.prisma.spaceCategory.delete({ where: { id: categoryId } });
    await this.audit(
      userId,
      spaceId,
      'CATEGORY_DELETE',
      'category',
      categoryId,
    );
    await this.changes.notify(spaceId);
    return { ok: true };
  }

  async reorder(
    userId: string,
    spaceId: string,
    input: {
      categoryIds: string[];
      channels: { id: string; categoryId?: string | null }[];
    },
  ) {
    await this.requirePermission(userId, spaceId, 'MANAGE_CHANNELS');
    const categoryIds = [...new Set(input.categoryIds)];
    const channelIds = [...new Set(input.channels.map((item) => item.id))];
    const [categoryCount, channelCount] = await Promise.all([
      this.prisma.spaceCategory.count({
        where: { spaceId, id: { in: categoryIds } },
      }),
      this.prisma.channel.count({
        where: { spaceId, id: { in: channelIds }, parentChannelId: null },
      }),
    ]);
    if (
      categoryCount !== categoryIds.length ||
      channelCount !== channelIds.length
    )
      throw new ConflictException('A ordenação contém itens inválidos.');
    const validCategoryIds = new Set(categoryIds);
    if (
      input.channels.some(
        (item) => item.categoryId && !validCategoryIds.has(item.categoryId),
      )
    )
      throw new ConflictException('Uma categoria da ordenação é inválida.');

    const positions = new Map<string, number>();
    await this.prisma.$transaction([
      ...categoryIds.map((id, position) =>
        this.prisma.spaceCategory.update({ where: { id }, data: { position } }),
      ),
      ...input.channels.map((item) => {
        const key = item.categoryId ?? 'uncategorized';
        const position = positions.get(key) ?? 0;
        positions.set(key, position + 1);
        return this.prisma.channel.update({
          where: { id: item.id },
          data: { categoryId: item.categoryId ?? null, position },
        });
      }),
    ]);
    await this.audit(userId, spaceId, 'CHANNELS_REORDER', 'space', spaceId);
    await this.changes.notify(spaceId);
    return { ok: true };
  }

  async createThread(userId: string, messageId: string, titleInput: string) {
    const source = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        thread: { select: { id: true } },
        channel: {
          select: {
            id: true,
            name: true,
            spaceId: true,
            isRestricted: true,
            parentChannelId: true,
            memberAccess: { select: { userId: true } },
            roleAccess: { select: { role: true } },
          },
        },
      },
    });
    if (!source) throw new NotFoundException('Mensagem não encontrada.');
    if (source.channel.parentChannelId)
      throw new ConflictException(
        'Não é possível criar uma thread dentro de outra thread.',
      );
    await this.spaces.accessibleChannel(
      userId,
      source.channel.id,
      ChannelKind.TEXT,
    );
    if (
      !(await this.spaces.hasPermission(
        userId,
        source.channel.spaceId,
        'SEND_MESSAGES',
      ))
    )
      throw new ForbiddenException('Você não pode criar threads neste canal.');
    if (source.thread) return this.thread(userId, source.thread.id);
    const title = this.normalizeName(titleInput, 80);
    if (!title) throw new ConflictException('Informe um título para a thread.');
    const name = await this.uniqueThreadName(source.channel.spaceId, title);
    const thread = await this.prisma.channel.create({
      data: {
        spaceId: source.channel.spaceId,
        name,
        topic: title,
        kind: ChannelKind.TEXT,
        parentChannelId: source.channel.id,
        starterMessageId: source.id,
        isRestricted: source.channel.isRestricted,
        memberAccess: {
          createMany: { data: source.channel.memberAccess },
        },
        roleAccess: {
          createMany: { data: source.channel.roleAccess },
        },
      },
    });
    await this.audit(
      userId,
      source.channel.spaceId,
      'THREAD_CREATE',
      'channel',
      thread.id,
      {
        title,
        sourceMessageId: messageId,
      },
    );
    await this.changes.notify(source.channel.spaceId);
    return this.thread(userId, thread.id);
  }

  async threads(userId: string, channelId: string) {
    const parent = await this.spaces.accessibleChannel(
      userId,
      channelId,
      ChannelKind.TEXT,
    );
    return this.prisma.channel.findMany({
      where: { parentChannelId: parent.id },
      orderBy: [{ archivedAt: 'asc' }, { createdAt: 'desc' }],
      select: this.threadSelect,
    });
  }

  async thread(userId: string, threadId: string) {
    const thread = await this.spaces.accessibleChannel(
      userId,
      threadId,
      ChannelKind.TEXT,
    );
    if (!thread.parentChannelId)
      throw new NotFoundException('Thread não encontrada.');
    return this.prisma.channel.findUniqueOrThrow({
      where: { id: threadId },
      select: this.threadSelect,
    });
  }

  async setThreadArchived(userId: string, threadId: string, archived: boolean) {
    const thread = await this.spaces.accessibleChannel(
      userId,
      threadId,
      ChannelKind.TEXT,
    );
    if (!thread.parentChannelId)
      throw new NotFoundException('Thread não encontrada.');
    if (
      !(await this.spaces.hasPermission(
        userId,
        thread.spaceId,
        'MANAGE_MESSAGES',
      )) &&
      archived
    )
      throw new ForbiddenException('Você não pode arquivar esta thread.');
    const updated = await this.prisma.channel.update({
      where: { id: threadId },
      data: { archivedAt: archived ? new Date() : null },
      select: this.threadSelect,
    });
    await this.audit(
      userId,
      thread.spaceId,
      archived ? 'THREAD_ARCHIVE' : 'THREAD_REOPEN',
      'channel',
      threadId,
    );
    await this.changes.notify(thread.spaceId);
    return updated;
  }

  async moderation(userId: string, spaceId: string) {
    await this.requirePermission(userId, spaceId, 'MODERATE_MEMBERS');
    const [members, bans] = await Promise.all([
      this.prisma.membership.findMany({
        where: { spaceId },
        orderBy: { user: { displayName: 'asc' } },
        select: {
          role: true,
          timedOutUntil: true,
          user: { select: { id: true, displayName: true, avatarUrl: true } },
        },
      }),
      this.prisma.spaceBan.findMany({
        where: { spaceId },
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, displayName: true, avatarUrl: true } },
        },
      }),
    ]);
    return {
      members: members.map((item) => ({
        ...item.user,
        role: item.role,
        timedOutUntil: item.timedOutUntil,
      })),
      bans: bans.map((item) => ({
        ...item.user,
        reason: item.reason,
        createdAt: item.createdAt,
      })),
    };
  }

  async timeoutMember(
    userId: string,
    spaceId: string,
    memberId: string,
    minutes: number,
  ) {
    await this.requirePermission(userId, spaceId, 'MODERATE_MEMBERS');
    const target = await this.requireModeratableMember(spaceId, memberId);
    if (target.role === 'admin' && !(await this.isOwner(userId, spaceId)))
      throw new ForbiddenException(
        'Somente o proprietário pode moderar administradores.',
      );
    const timedOutUntil =
      minutes > 0
        ? new Date(Date.now() + Math.min(minutes, 40320) * 60_000)
        : null;
    await this.prisma.membership.update({
      where: { userId_spaceId: { userId: memberId, spaceId } },
      data: { timedOutUntil },
    });
    await this.audit(
      userId,
      spaceId,
      timedOutUntil ? 'MEMBER_TIMEOUT' : 'MEMBER_TIMEOUT_CLEAR',
      'user',
      memberId,
      {
        minutes,
      },
    );
    await this.changes.notify(spaceId);
    return { timedOutUntil };
  }

  async banMember(
    userId: string,
    spaceId: string,
    memberId: string,
    reasonInput: string,
  ) {
    await this.requirePermission(userId, spaceId, 'MODERATE_MEMBERS');
    const target = await this.requireModeratableMember(spaceId, memberId);
    if (target.role === 'admin' && !(await this.isOwner(userId, spaceId)))
      throw new ForbiddenException(
        'Somente o proprietário pode banir administradores.',
      );
    const reason = reasonInput.trim().slice(0, 300);
    await this.prisma.$transaction([
      this.prisma.spaceBan.upsert({
        where: { spaceId_userId: { spaceId, userId: memberId } },
        create: { spaceId, userId: memberId, reason },
        update: { reason, createdAt: new Date() },
      }),
      this.prisma.membership.delete({
        where: { userId_spaceId: { userId: memberId, spaceId } },
      }),
    ]);
    await this.audit(userId, spaceId, 'MEMBER_BAN', 'user', memberId, {
      reason,
    });
    await this.changes.notify(spaceId);
    return { ok: true };
  }

  async unbanMember(userId: string, spaceId: string, memberId: string) {
    await this.requirePermission(userId, spaceId, 'MODERATE_MEMBERS');
    const result = await this.prisma.spaceBan.deleteMany({
      where: { spaceId, userId: memberId },
    });
    if (!result.count) throw new NotFoundException('Banimento não encontrado.');
    await this.audit(userId, spaceId, 'MEMBER_UNBAN', 'user', memberId);
    return { ok: true };
  }

  async auditLog(userId: string, spaceId: string) {
    await this.requirePermission(userId, spaceId, 'VIEW_AUDIT_LOG');
    return this.prisma.auditLog.findMany({
      where: { spaceId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        details: true,
        createdAt: true,
        actor: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });
  }

  async mentions(userId: string, channelId: string) {
    const channel = await this.spaces.accessibleChannel(
      userId,
      channelId,
      ChannelKind.TEXT,
    );
    const [members, roles] = await Promise.all([
      this.spaces.members(userId, channel.spaceId),
      this.prisma.spaceRole.findMany({
        where: { spaceId: channel.spaceId },
        orderBy: { position: 'desc' },
        select: { id: true, name: true, color: true },
      }),
    ]);
    return {
      members,
      roles,
      canMentionEveryone: await this.spaces.hasPermission(
        userId,
        channel.spaceId,
        'MENTION_EVERYONE',
      ),
    };
  }

  async stickers(userId: string, spaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
      select: { userId: true },
    });
    if (!membership)
      throw new ForbiddenException('Você não pertence a esta comunidade.');
    return this.prisma.spaceSticker
      .findMany({
        where: { spaceId },
        orderBy: { name: 'asc' },
        select: this.stickerSelect,
      })
      .then((items) => items.map((item) => this.publicSticker(item)));
  }

  async createSticker(
    userId: string,
    spaceId: string,
    nameInput: string,
    file: Express.Multer.File,
  ) {
    try {
      await this.media.validateImage(file);
      await this.requirePermission(userId, spaceId, 'MANAGE_STICKERS');
      const name = this.normalizeName(nameInput, 40);
      if (!name)
        throw new ConflictException('Informe um nome para a figurinha.');
      const sticker = await this.prisma.spaceSticker.create({
        data: {
          spaceId,
          uploaderId: userId,
          name,
          storedName: file.filename,
          mimeType: file.mimetype,
          size: file.size,
        },
        select: this.stickerSelect,
      });
      await this.audit(
        userId,
        spaceId,
        'STICKER_CREATE',
        'sticker',
        sticker.id,
        { name },
      );
      return this.publicSticker(sticker);
    } catch (error) {
      await this.media.remove(file.filename);
      if (this.isUniqueConflict(error))
        throw new ConflictException('Já existe uma figurinha com esse nome.');
      throw error;
    }
  }

  async deleteSticker(userId: string, spaceId: string, stickerId: string) {
    await this.requirePermission(userId, spaceId, 'MANAGE_STICKERS');
    const sticker = await this.prisma.spaceSticker.findFirst({
      where: { id: stickerId, spaceId },
      select: { id: true, storedName: true },
    });
    if (!sticker) throw new NotFoundException('Figurinha não encontrada.');
    await this.prisma.spaceSticker.delete({ where: { id: stickerId } });
    await this.media.remove(sticker.storedName);
    await this.audit(userId, spaceId, 'STICKER_DELETE', 'sticker', stickerId);
    return { ok: true };
  }

  async updateSpaceIcon(userId: string, spaceId: string, storedName: string) {
    let space: { iconUrl: string | null };
    const iconUrl = `/uploads/${storedName}`;
    try {
      await this.requirePermission(userId, spaceId, 'MANAGE_MEMBERS');
      space = await this.prisma.space.findUniqueOrThrow({
        where: { id: spaceId },
        select: { iconUrl: true },
      });
      await this.prisma.space.update({
        where: { id: spaceId },
        data: { iconUrl },
      });
    } catch (error) {
      await this.media.remove(storedName);
      throw error;
    }
    const previous = storedUploadName(space.iconUrl);
    if (previous && previous !== storedName) await this.media.remove(previous);
    await this.audit(userId, spaceId, 'SPACE_ICON_UPDATE', 'space', spaceId);
    await this.changes.notify(spaceId);
    return { iconUrl };
  }

  async removeSpaceIcon(userId: string, spaceId: string) {
    await this.requirePermission(userId, spaceId, 'MANAGE_MEMBERS');
    const space = await this.prisma.space.findUniqueOrThrow({
      where: { id: spaceId },
      select: { iconUrl: true },
    });
    await this.prisma.space.update({
      where: { id: spaceId },
      data: { iconUrl: null },
    });
    const storedName = storedUploadName(space.iconUrl);
    if (storedName) await this.media.remove(storedName);
    await this.audit(userId, spaceId, 'SPACE_ICON_REMOVE', 'space', spaceId);
    await this.changes.notify(spaceId);
    return { iconUrl: null };
  }

  private requirePermission(
    userId: string,
    spaceId: string,
    permission: Parameters<SpacesService['hasPermission']>[2],
  ) {
    return this.spaces
      .hasPermission(userId, spaceId, permission)
      .then((allowed) => {
        if (!allowed)
          throw new ForbiddenException(
            'Você não possui permissão para fazer isso.',
          );
      });
  }

  private requireCategory(spaceId: string, categoryId: string) {
    return this.prisma.spaceCategory
      .findFirst({
        where: { id: categoryId, spaceId },
        select: { id: true },
      })
      .then((category) => {
        if (!category) throw new NotFoundException('Categoria não encontrada.');
        return category;
      });
  }

  private requireModeratableMember(spaceId: string, memberId: string) {
    return this.prisma.membership
      .findUnique({
        where: { userId_spaceId: { userId: memberId, spaceId } },
        select: { role: true },
      })
      .then((membership) => {
        if (!membership) throw new NotFoundException('Membro não encontrado.');
        if (membership.role === 'owner')
          throw new ForbiddenException('O proprietário não pode ser moderado.');
        return membership;
      });
  }

  private async isOwner(userId: string, spaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
      select: { role: true },
    });
    return membership?.role === 'owner';
  }

  private audit(
    actorId: string,
    spaceId: string,
    action: string,
    targetType: string,
    targetId?: string,
    details: Prisma.InputJsonValue = {},
  ) {
    return this.prisma.auditLog.create({
      data: { actorId, spaceId, action, targetType, targetId, details },
    });
  }

  private async uniqueThreadName(spaceId: string, title: string) {
    const base =
      title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 42) || 'thread';
    const existing = await this.prisma.channel.findFirst({
      where: { spaceId, name: base },
      select: { id: true },
    });
    return existing ? `${base}-${crypto.randomUUID().slice(0, 6)}` : base;
  }

  private normalizeName(value: string, max: number) {
    return value.trim().replace(/\s+/g, ' ').slice(0, max);
  }

  private publicSticker(sticker: {
    id: string;
    name: string;
    storedName: string;
    mimeType: string;
    size: number;
  }) {
    return {
      id: sticker.id,
      name: sticker.name,
      mimeType: sticker.mimeType,
      size: sticker.size,
      url: `/uploads/${sticker.storedName}`,
    };
  }

  private readonly threadSelect = {
    id: true,
    name: true,
    topic: true,
    parentChannelId: true,
    starterMessageId: true,
    archivedAt: true,
    createdAt: true,
    _count: { select: { messages: true } },
  } as const;

  private readonly stickerSelect = {
    id: true,
    name: true,
    storedName: true,
    mimeType: true,
    size: true,
  } as const;

  private isUniqueConflict(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
