import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChannelKind, Prisma, SpaceKind } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { SpaceChangeRegistry } from './space-change.registry';
import { MediaService } from './media.service';

export const SPACE_PERMISSIONS = [
  'MANAGE_CHANNELS',
  'MANAGE_MEMBERS',
  'MANAGE_MESSAGES',
  'MANAGE_INVITES',
  'SEND_MESSAGES',
  'ATTACH_FILES',
  'CONNECT_VOICE',
  'SHARE_SCREEN',
  'MODERATE_MEMBERS',
  'VIEW_AUDIT_LOG',
  'MENTION_EVERYONE',
  'MANAGE_STICKERS',
] as const;
export type SpacePermission = (typeof SPACE_PERMISSIONS)[number];

@Injectable()
export class SpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaceChanges: SpaceChangeRegistry,
    private readonly media: MediaService,
  ) {}

  async listForUser(userId: string) {
    return this.listForKinds(userId, [SpaceKind.COMMUNITY]);
  }

  async listPrivateForUser(userId: string) {
    return this.listForKinds(userId, [SpaceKind.DIRECT, SpaceKind.GROUP]);
  }

  async privateSpaceForUser(userId: string, spaceId: string) {
    const spaces = await this.listPrivateForUser(userId);
    const space = spaces.find((item) => item.id === spaceId);
    if (!space) throw new NotFoundException('Conversa não encontrada.');
    return space;
  }

  private async listForKinds(userId: string, kinds: SpaceKind[]) {
    const memberships = await this.membershipsForUser(userId, kinds);
    return Promise.all(
      memberships.map(async (membership) => {
        const channels = await Promise.all(
          membership.space.channels
            .filter((channel) => !channel.parentChannelId)
            .filter((channel) =>
              this.membershipCanAccessChannel(
                membership.role,
                membership.assignedRoles.map((assigned) => assigned.roleId),
                userId,
                channel,
              ),
            )
            .map(async (channel) => ({
              id: channel.id,
              spaceId: channel.spaceId,
              categoryId: channel.categoryId,
              name: channel.name,
              topic: channel.topic,
              kind: channel.kind,
              position: channel.position,
              isRestricted: channel.isRestricted,
              unreadCount: await this.prisma.message.count({
                where: {
                  channelId: channel.id,
                  authorId: { not: userId },
                  createdAt: {
                    gt: channel.readStates[0]?.lastReadAt ?? new Date(0),
                  },
                },
              }),
              createdAt: channel.createdAt,
            })),
        );
        const directPeer =
          membership.space.kind === SpaceKind.DIRECT
            ? membership.space.memberships.find(
                (item) => item.userId !== userId,
              )?.user
            : null;
        return {
          id: membership.space.id,
          name: directPeer?.displayName ?? membership.space.name,
          kind: membership.space.kind,
          iconUrl: directPeer?.avatarUrl ?? membership.space.iconUrl,
          description: membership.space.description,
          role: membership.role,
          permissions: ['owner', 'admin'].includes(membership.role)
            ? [...SPACE_PERMISSIONS]
            : [
                ...new Set(
                  membership.assignedRoles.flatMap(
                    (assigned) => assigned.role.permissions,
                  ),
                ),
              ],
          channels,
          categories: membership.space.categories,
          members: membership.space.memberships.map((item) => ({
            ...item.user,
            role: item.role,
          })),
        };
      }),
    );
  }

  async createSpace(userId: string, input: { name: string }) {
    const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!name)
      throw new ConflictException('Informe um nome válido para a comunidade.');

    const space = await this.prisma.space.create({
      data: {
        name,
        kind: SpaceKind.COMMUNITY,
        memberships: { create: { userId, role: 'owner' } },
        channels: {
          create: [
            { name: 'geral', kind: ChannelKind.TEXT, position: 0 },
            { name: 'Geral', kind: ChannelKind.VOICE, position: 1 },
          ],
        },
      },
      include: { channels: { orderBy: { position: 'asc' } } },
    });

    await this.audit(userId, space.id, 'SPACE_CREATE', 'space', space.id, {
      name,
    });

    return {
      id: space.id,
      name: space.name,
      role: 'owner',
      channels: space.channels,
    };
  }

  async management(userId: string, spaceId: string) {
    await this.requirePermission(userId, spaceId, 'MANAGE_MEMBERS');
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: {
        id: true,
        name: true,
        iconUrl: true,
        description: true,
        roles: { orderBy: [{ position: 'desc' }, { name: 'asc' }] },
        invites: {
          where: {
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            code: true,
            uses: true,
            maxUses: true,
            expiresAt: true,
            createdAt: true,
          },
        },
        memberships: {
          orderBy: { user: { displayName: 'asc' } },
          select: {
            role: true,
            user: { select: { id: true, displayName: true, email: true } },
            assignedRoles: { select: { roleId: true } },
          },
        },
      },
    });
    if (!space) throw new NotFoundException('Comunidade não encontrada.');
    return {
      id: space.id,
      name: space.name,
      roles: space.roles,
      invites: space.invites,
      members: space.memberships.map((membership) => ({
        ...membership.user,
        role: membership.role,
        roleIds: membership.assignedRoles.map((assigned) => assigned.roleId),
      })),
    };
  }

  async renameSpace(
    userId: string,
    spaceId: string,
    value: string,
    description?: string,
  ) {
    await this.requirePermission(userId, spaceId, 'MANAGE_MEMBERS');
    const name = this.normalizeName(value, 80);
    if (!name) throw new ConflictException('Informe um nome válido.');
    const space = await this.prisma.space.update({
      where: { id: spaceId },
      data: {
        name,
        description: description?.trim().slice(0, 300) ?? undefined,
      },
      select: { id: true, name: true, description: true, iconUrl: true },
    });
    await this.audit(userId, spaceId, 'SPACE_UPDATE', 'space', spaceId, {
      name,
    });
    await this.spaceChanges.notify(spaceId);
    return space;
  }

  async deleteSpace(userId: string, spaceId: string) {
    await this.requireOwner(userId, spaceId);
    const storedNames = await this.media.spaceUploads(spaceId);
    await this.prisma.space.delete({ where: { id: spaceId } });
    await this.media.removeMany(storedNames);
    await this.spaceChanges.notify(spaceId);
    return { ok: true };
  }

  async createRole(
    userId: string,
    spaceId: string,
    input: { name: string; color: string; permissions?: string[] },
  ) {
    await this.requirePermission(userId, spaceId, 'MANAGE_MEMBERS');
    const name = this.normalizeName(input.name, 40);
    if (!name)
      throw new ConflictException('Informe um nome válido para o cargo.');
    const last = await this.prisma.spaceRole.findFirst({
      where: { spaceId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    try {
      const role = await this.prisma.spaceRole.create({
        data: {
          spaceId,
          name,
          color: input.color.toLowerCase(),
          permissions: this.validPermissions(input.permissions),
          position: (last?.position ?? 0) + 1,
        },
      });
      await this.audit(userId, spaceId, 'ROLE_CREATE', 'role', role.id, {
        name,
      });
      return role;
    } catch (error) {
      if (this.isUniqueConflict(error))
        throw new ConflictException('Já existe um cargo com esse nome.');
      throw error;
    }
  }

  async updateRole(
    userId: string,
    spaceId: string,
    roleId: string,
    input: { name: string; color: string; permissions?: string[] },
  ) {
    await this.requirePermission(userId, spaceId, 'MANAGE_MEMBERS');
    await this.requireSpaceRole(spaceId, roleId);
    const name = this.normalizeName(input.name, 40);
    if (!name)
      throw new ConflictException('Informe um nome válido para o cargo.');
    const role = await this.prisma.spaceRole.update({
      where: { id: roleId },
      data: {
        name,
        color: input.color.toLowerCase(),
        permissions: this.validPermissions(input.permissions),
      },
    });
    await this.audit(userId, spaceId, 'ROLE_UPDATE', 'role', roleId, {
      name,
    });
    await this.spaceChanges.notify(spaceId);
    return role;
  }

  async deleteRole(userId: string, spaceId: string, roleId: string) {
    await this.requirePermission(userId, spaceId, 'MANAGE_MEMBERS');
    await this.requireSpaceRole(spaceId, roleId);
    await this.prisma.$transaction([
      this.prisma.channelRoleAccess.deleteMany({
        where: { channel: { spaceId }, role: roleId },
      }),
      this.prisma.spaceRole.delete({ where: { id: roleId } }),
    ]);
    await this.audit(userId, spaceId, 'ROLE_DELETE', 'role', roleId);
    await this.spaceChanges.notify(spaceId);
    return { ok: true };
  }

  async updateMember(
    userId: string,
    spaceId: string,
    memberId: string,
    input: { role: string; roleIds: string[] },
  ) {
    await this.requirePermission(userId, spaceId, 'MANAGE_MEMBERS');
    const target = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId: memberId, spaceId } },
      select: { role: true },
    });
    if (!target) throw new NotFoundException('Membro não encontrado.');
    if (target.role === 'owner')
      throw new ForbiddenException('O proprietário não pode ser alterado.');
    const roleIds = [...new Set(input.roleIds)];
    const validRoles = await this.prisma.spaceRole.count({
      where: { spaceId, id: { in: roleIds } },
    });
    if (validRoles !== roleIds.length)
      throw new ConflictException('Um dos cargos não pertence à comunidade.');
    await this.prisma.$transaction([
      this.prisma.membership.update({
        where: { userId_spaceId: { userId: memberId, spaceId } },
        data: { role: input.role },
      }),
      this.prisma.membershipRole.deleteMany({
        where: { userId: memberId, spaceId },
      }),
      this.prisma.membershipRole.createMany({
        data: roleIds.map((roleId) => ({ userId: memberId, spaceId, roleId })),
      }),
    ]);
    await this.audit(userId, spaceId, 'MEMBER_UPDATE', 'user', memberId, {
      role: input.role,
      roleIds,
    });
    await this.spaceChanges.notify(spaceId);
    return { id: memberId, role: input.role, roleIds };
  }

  async removeMember(userId: string, spaceId: string, memberId: string) {
    await this.requirePermission(userId, spaceId, 'MANAGE_MEMBERS');
    const target = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId: memberId, spaceId } },
      select: { role: true },
    });
    if (!target) throw new NotFoundException('Membro não encontrado.');
    if (target.role === 'owner')
      throw new ForbiddenException('O proprietário não pode ser removido.');
    await this.prisma.membership.delete({
      where: { userId_spaceId: { userId: memberId, spaceId } },
    });
    await this.audit(userId, spaceId, 'MEMBER_REMOVE', 'user', memberId);
    await this.spaceChanges.notify(spaceId);
    return { ok: true };
  }

  async renameChannel(
    userId: string,
    spaceId: string,
    channelId: string,
    value: string,
    topicValue?: string,
    categoryId?: string | null,
  ) {
    await this.requirePermission(userId, spaceId, 'MANAGE_CHANNELS');
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, spaceId },
      select: { kind: true },
    });
    if (!channel) throw new NotFoundException('Canal não encontrado.');
    if (categoryId) {
      const category = await this.prisma.spaceCategory.findFirst({
        where: { id: categoryId, spaceId },
        select: { id: true },
      });
      if (!category)
        throw new ConflictException('A categoria selecionada não existe.');
    }
    const name = this.normalizeChannelName(value, channel.kind);
    if (!name)
      throw new ConflictException('Informe um nome válido para o canal.');
    const updated = await this.prisma.channel.update({
      where: { id: channelId },
      data: {
        name,
        topic: topicValue?.trim().slice(0, 1024) ?? undefined,
        categoryId: categoryId === undefined ? undefined : categoryId,
      },
    });
    await this.audit(userId, spaceId, 'CHANNEL_UPDATE', 'channel', channelId, {
      name,
    });
    await this.spaceChanges.notify(spaceId);
    return updated;
  }

  async deleteChannel(userId: string, spaceId: string, channelId: string) {
    await this.requirePermission(userId, spaceId, 'MANAGE_CHANNELS');
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, spaceId },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException('Canal não encontrado.');
    const storedNames = await this.media.channelUploads(channelId);
    await this.prisma.channel.delete({ where: { id: channelId } });
    await this.media.removeMany(storedNames);
    await this.audit(userId, spaceId, 'CHANNEL_DELETE', 'channel', channelId);
    await this.spaceChanges.notify(spaceId);
    return { ok: true };
  }

  async createChannel(
    userId: string,
    spaceId: string,
    input: { name: string; kind: ChannelKind; categoryId?: string },
  ) {
    await this.requirePermission(userId, spaceId, 'MANAGE_CHANNELS');
    const name = this.normalizeChannelName(input.name, input.kind);
    if (!name)
      throw new ConflictException('Informe um nome válido para o canal.');
    if (input.categoryId) {
      const category = await this.prisma.spaceCategory.findFirst({
        where: { id: input.categoryId, spaceId },
        select: { id: true },
      });
      if (!category)
        throw new ConflictException('A categoria selecionada não existe.');
    }
    const lastChannel = await this.prisma.channel.findFirst({
      where: { spaceId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    try {
      const channel = await this.prisma.channel.create({
        data: {
          spaceId,
          name,
          kind: input.kind,
          categoryId: input.categoryId ?? null,
          position: (lastChannel?.position ?? -1) + 1,
        },
      });
      await this.audit(
        userId,
        spaceId,
        'CHANNEL_CREATE',
        'channel',
        channel.id,
        {
          name,
          kind: input.kind,
        },
      );
      await this.spaceChanges.notify(spaceId);
      return channel;
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException('Já existe um canal com esse nome.');
      }
      throw error;
    }
  }

  async createInvite(
    userId: string,
    spaceId: string,
    input: { expiresInDays?: number; maxUses?: number } = {},
  ) {
    await this.requirePermission(userId, spaceId, 'MANAGE_INVITES');
    const days = Math.max(1, Math.min(input.expiresInDays ?? 7, 30));
    const maxUses = input.maxUses
      ? Math.max(1, Math.min(input.maxUses, 1000))
      : null;
    const invite = await this.prisma.spaceInvite.create({
      data: {
        code: crypto.randomUUID().replaceAll('-', ''),
        spaceId,
        createdById: userId,
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        maxUses,
      },
      select: {
        id: true,
        code: true,
        expiresAt: true,
        maxUses: true,
        uses: true,
      },
    });
    await this.audit(userId, spaceId, 'INVITE_CREATE', 'invite', invite.id, {
      maxUses,
      expiresInDays: days,
    });
    return invite;
  }

  async listInvites(userId: string, spaceId: string) {
    await this.requirePermission(userId, spaceId, 'MANAGE_INVITES');
    return this.prisma.spaceInvite.findMany({
      where: {
        spaceId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        uses: true,
        maxUses: true,
        expiresAt: true,
        createdAt: true,
        createdBy: { select: { displayName: true } },
      },
    });
  }

  async revokeInvite(userId: string, spaceId: string, inviteId: string) {
    await this.requirePermission(userId, spaceId, 'MANAGE_INVITES');
    const result = await this.prisma.spaceInvite.updateMany({
      where: { id: inviteId, spaceId },
      data: { revokedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Convite não encontrado.');
    await this.audit(userId, spaceId, 'INVITE_REVOKE', 'invite', inviteId);
    return { ok: true };
  }

  async channelAccess(userId: string, spaceId: string, channelId: string) {
    await this.requirePermission(userId, spaceId, 'MANAGE_CHANNELS');
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, spaceId },
      select: {
        id: true,
        isRestricted: true,
        memberAccess: { select: { userId: true } },
        roleAccess: { select: { role: true } },
      },
    });
    if (!channel) throw new NotFoundException('Canal não encontrado.');
    const members = await this.prisma.membership.findMany({
      where: { spaceId },
      orderBy: { user: { displayName: 'asc' } },
      select: {
        role: true,
        user: { select: { id: true, displayName: true, email: true } },
      },
    });
    return {
      restricted: channel.isRestricted,
      memberIds: channel.memberAccess.map((access) => access.userId),
      roles: channel.roleAccess.map((access) => access.role),
      members: members.map((membership) => ({
        ...membership.user,
        role: membership.role,
      })),
      availableRoles: [
        { id: 'owner', name: 'Proprietário' },
        { id: 'admin', name: 'Administrador' },
        { id: 'member', name: 'Membro' },
        ...(await this.prisma.spaceRole.findMany({
          where: { spaceId },
          orderBy: { position: 'desc' },
          select: { id: true, name: true, color: true },
        })),
      ],
    };
  }

  async updateChannelAccess(
    userId: string,
    spaceId: string,
    channelId: string,
    input: { restricted: boolean; memberIds: string[]; roles: string[] },
  ) {
    await this.requirePermission(userId, spaceId, 'MANAGE_CHANNELS');
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, spaceId },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException('Canal não encontrado.');

    const memberIds = [...new Set(input.memberIds)];
    const roles = [...new Set(input.roles)];
    const customRoleIds = roles.filter(
      (role) => !['owner', 'admin', 'member'].includes(role),
    );
    const validCustomRoles = await this.prisma.spaceRole.count({
      where: { spaceId, id: { in: customRoleIds } },
    });
    if (validCustomRoles !== customRoleIds.length) {
      throw new ConflictException('Um dos cargos não pertence à comunidade.');
    }
    const validMembers = await this.prisma.membership.findMany({
      where: { spaceId, userId: { in: memberIds } },
      select: { userId: true },
    });
    if (validMembers.length !== memberIds.length) {
      throw new ConflictException('Um dos membros não pertence à comunidade.');
    }

    await this.prisma.$transaction([
      this.prisma.channel.update({
        where: { id: channelId },
        data: { isRestricted: input.restricted },
      }),
      this.prisma.channelMemberAccess.deleteMany({ where: { channelId } }),
      this.prisma.channelRoleAccess.deleteMany({ where: { channelId } }),
      this.prisma.channelMemberAccess.createMany({
        data: memberIds.map((memberId) => ({ channelId, userId: memberId })),
      }),
      this.prisma.channelRoleAccess.createMany({
        data: roles.map((role) => ({ channelId, role })),
      }),
    ]);
    await this.audit(
      userId,
      spaceId,
      'CHANNEL_ACCESS_UPDATE',
      'channel',
      channelId,
      {
        restricted: input.restricted,
        memberIds,
        roles,
      },
    );
    await this.spaceChanges.notify(spaceId);
    return { restricted: input.restricted, memberIds, roles };
  }

  async joinByInvite(userId: string, code: string) {
    const invite = await this.prisma.spaceInvite.findUnique({
      where: { code: code.trim() },
      include: { space: true },
    });
    if (
      !invite ||
      invite.revokedAt ||
      (invite.expiresAt && invite.expiresAt <= new Date()) ||
      (invite.maxUses !== null && invite.uses >= invite.maxUses)
    ) {
      throw new NotFoundException('Este convite não existe ou expirou.');
    }
    const banned = await this.prisma.spaceBan.findUnique({
      where: { spaceId_userId: { spaceId: invite.spaceId, userId } },
      select: { userId: true },
    });
    if (banned)
      throw new ForbiddenException('Você não pode entrar nesta comunidade.');
    await this.prisma.$transaction([
      this.prisma.membership.upsert({
        where: { userId_spaceId: { userId, spaceId: invite.spaceId } },
        update: {},
        create: { userId, spaceId: invite.spaceId, role: 'member' },
      }),
      this.prisma.spaceInvite.update({
        where: { id: invite.id },
        data: { uses: { increment: 1 } },
      }),
    ]);
    await this.spaceChanges.notify(invite.spaceId);
    return { id: invite.space.id, name: invite.space.name };
  }

  async accessibleChannel(
    userId: string,
    channelId: string,
    kind?: ChannelKind,
  ) {
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: channelId,
        ...(kind ? { kind } : {}),
        space: { memberships: { some: { userId } } },
      },
      include: {
        memberAccess: { where: { userId }, select: { userId: true } },
        roleAccess: { select: { role: true } },
        space: {
          select: {
            memberships: {
              where: { userId },
              select: {
                role: true,
                assignedRoles: { select: { roleId: true } },
              },
            },
          },
        },
      },
    });
    const membership = channel?.space.memberships[0];
    if (
      !channel ||
      !membership ||
      !this.membershipCanAccessChannel(
        membership.role,
        membership.assignedRoles.map((assigned) => assigned.roleId),
        userId,
        channel,
      )
    )
      throw new ForbiddenException('Você não tem acesso a este canal.');
    return channel;
  }

  async canAccessChannel(userId: string, channelId: string) {
    try {
      await this.accessibleChannel(userId, channelId);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  async canManageSpace(userId: string, spaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
      select: { role: true },
    });
    return !!membership && ['owner', 'admin'].includes(membership.role);
  }

  async hasPermission(
    userId: string,
    spaceId: string,
    permission: SpacePermission,
  ) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
      select: {
        role: true,
        timedOutUntil: true,
        assignedRoles: { select: { role: { select: { permissions: true } } } },
      },
    });
    if (!membership) return false;
    if (
      membership.timedOutUntil &&
      membership.timedOutUntil > new Date() &&
      [
        'SEND_MESSAGES',
        'ATTACH_FILES',
        'CONNECT_VOICE',
        'SHARE_SCREEN',
      ].includes(permission)
    )
      return false;
    if (['owner', 'admin'].includes(membership.role)) return true;
    if (
      [
        'SEND_MESSAGES',
        'ATTACH_FILES',
        'CONNECT_VOICE',
        'SHARE_SCREEN',
      ].includes(permission)
    )
      return true;
    return membership.assignedRoles.some((assignment) =>
      assignment.role.permissions.includes(permission),
    );
  }

  async members(userId: string, spaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
      select: { userId: true },
    });
    if (!membership)
      throw new ForbiddenException('Você não pertence a esta comunidade.');
    return this.prisma.membership
      .findMany({
        where: { spaceId },
        orderBy: { user: { displayName: 'asc' } },
        select: {
          role: true,
          user: {
            select: {
              id: true,
              displayName: true,
              avatarUrl: true,
              status: true,
            },
          },
          assignedRoles: {
            select: { role: { select: { id: true, name: true, color: true } } },
          },
        },
      })
      .then((items) =>
        items.map((item) => ({
          ...item.user,
          role: item.role,
          roles: item.assignedRoles.map((entry) => entry.role),
        })),
      );
  }

  async leaveSpace(userId: string, spaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException('Comunidade não encontrada.');
    if (membership.role === 'owner')
      throw new ForbiddenException('Transfira a propriedade antes de sair.');
    await this.prisma.membership.delete({
      where: { userId_spaceId: { userId, spaceId } },
    });
    await this.spaceChanges.notify(spaceId);
    return { ok: true };
  }

  async transferOwnership(userId: string, spaceId: string, memberId: string) {
    await this.requireOwner(userId, spaceId);
    const target = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId: memberId, spaceId } },
    });
    if (!target || memberId === userId)
      throw new ConflictException('Escolha outro membro da comunidade.');
    await this.prisma.$transaction([
      this.prisma.membership.update({
        where: { userId_spaceId: { userId, spaceId } },
        data: { role: 'admin' },
      }),
      this.prisma.membership.update({
        where: { userId_spaceId: { userId: memberId, spaceId } },
        data: { role: 'owner' },
      }),
    ]);
    await this.audit(userId, spaceId, 'OWNERSHIP_TRANSFER', 'user', memberId);
    await this.spaceChanges.notify(spaceId);
    return { ok: true };
  }

  async spaceIdsForUser(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { spaceId: true },
    });
    return memberships.map((membership) => membership.spaceId);
  }

  async channelIdsForUser(userId: string) {
    const memberships = await this.membershipsForUser(userId);
    return memberships.flatMap((membership) =>
      membership.space.channels
        .filter((channel) =>
          this.membershipCanAccessChannel(
            membership.role,
            membership.assignedRoles.map((assigned) => assigned.roleId),
            userId,
            channel,
          ),
        )
        .map((channel) => channel.id),
    );
  }

  private membershipsForUser(userId: string, kinds?: SpaceKind[]) {
    return this.prisma.membership.findMany({
      where: {
        userId,
        ...(kinds ? { space: { kind: { in: kinds } } } : {}),
      },
      orderBy: { space: { createdAt: 'asc' } },
      include: {
        assignedRoles: {
          select: { roleId: true, role: { select: { permissions: true } } },
        },
        space: {
          include: {
            categories: { orderBy: { position: 'asc' } },
            memberships: {
              orderBy: { user: { displayName: 'asc' } },
              select: {
                userId: true,
                role: true,
                user: {
                  select: {
                    id: true,
                    displayName: true,
                    avatarUrl: true,
                    status: true,
                  },
                },
              },
            },
            channels: {
              orderBy: { position: 'asc' },
              include: {
                memberAccess: { where: { userId }, select: { userId: true } },
                roleAccess: { select: { role: true } },
                readStates: { where: { userId }, select: { lastReadAt: true } },
              },
            },
            roles: true,
          },
        },
      },
    });
  }

  private async requireManager(userId: string, spaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
      select: { role: true },
    });
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      throw new ForbiddenException('Somente administradores podem fazer isso.');
    }
  }

  private async requirePermission(
    userId: string,
    spaceId: string,
    permission: SpacePermission,
  ) {
    if (!(await this.hasPermission(userId, spaceId, permission))) {
      throw new ForbiddenException(
        'Você não possui permissão para fazer isso.',
      );
    }
  }

  private async requireOwner(userId: string, spaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
      select: { role: true },
    });
    if (membership?.role !== 'owner')
      throw new ForbiddenException('Somente o proprietário pode fazer isso.');
  }

  private async requireSpaceRole(spaceId: string, roleId: string) {
    const role = await this.prisma.spaceRole.findFirst({
      where: { id: roleId, spaceId },
      select: { id: true },
    });
    if (!role) throw new NotFoundException('Cargo não encontrado.');
  }

  private normalizeName(value: string, maxLength: number) {
    return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  }

  private membershipCanAccessChannel(
    role: string,
    customRoleIds: string[],
    userId: string,
    channel: {
      isRestricted: boolean;
      memberAccess: { userId: string }[];
      roleAccess: { role: string }[];
    },
  ) {
    return (
      !channel.isRestricted ||
      ['owner', 'admin'].includes(role) ||
      channel.memberAccess.some((access) => access.userId === userId) ||
      channel.roleAccess.some(
        (access) => access.role === role || customRoleIds.includes(access.role),
      )
    );
  }

  private normalizeChannelName(name: string, kind: ChannelKind) {
    const safeName = name
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 50);
    if (kind === ChannelKind.VOICE) return safeName;
    return safeName
      .toLowerCase()
      .replace(/[ _]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private validPermissions(input: string[] | undefined) {
    return [...new Set(input ?? [])].filter(
      (permission): permission is SpacePermission =>
        SPACE_PERMISSIONS.includes(permission as SpacePermission),
    );
  }

  private isUniqueConflict(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
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
}
