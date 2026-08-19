import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChannelKind } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { SpaceChangeRegistry } from './space-change.registry';

@Injectable()
export class SpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaceChanges: SpaceChangeRegistry,
  ) {}

  async listForUser(userId: string) {
    const memberships = await this.membershipsForUser(userId);
    return memberships.map((membership) => ({
      id: membership.space.id,
      name: membership.space.name,
      role: membership.role,
      channels: membership.space.channels
        .filter((channel) =>
          this.membershipCanAccessChannel(
            membership.role,
            membership.assignedRoles.map((assigned) => assigned.roleId),
            userId,
            channel,
          ),
        )
        .map((channel) => ({
          id: channel.id,
          spaceId: channel.spaceId,
          name: channel.name,
          kind: channel.kind,
          position: channel.position,
          isRestricted: channel.isRestricted,
          createdAt: channel.createdAt,
        })),
    }));
  }

  async createSpace(userId: string, input: { name: string }) {
    const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!name)
      throw new ConflictException('Informe um nome válido para a comunidade.');

    const space = await this.prisma.space.create({
      data: {
        name,
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

    return {
      id: space.id,
      name: space.name,
      role: 'owner',
      channels: space.channels,
    };
  }

  async management(userId: string, spaceId: string) {
    await this.requireManager(userId, spaceId);
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: {
        id: true,
        name: true,
        roles: { orderBy: [{ position: 'desc' }, { name: 'asc' }] },
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
      members: space.memberships.map((membership) => ({
        ...membership.user,
        role: membership.role,
        roleIds: membership.assignedRoles.map((assigned) => assigned.roleId),
      })),
    };
  }

  async renameSpace(userId: string, spaceId: string, value: string) {
    await this.requireManager(userId, spaceId);
    const name = this.normalizeName(value, 80);
    if (!name) throw new ConflictException('Informe um nome válido.');
    const space = await this.prisma.space.update({
      where: { id: spaceId },
      data: { name },
      select: { id: true, name: true },
    });
    await this.spaceChanges.notify(spaceId);
    return space;
  }

  async deleteSpace(userId: string, spaceId: string) {
    await this.requireOwner(userId, spaceId);
    await this.prisma.space.delete({ where: { id: spaceId } });
    await this.spaceChanges.notify(spaceId);
    return { ok: true };
  }

  async createRole(
    userId: string,
    spaceId: string,
    input: { name: string; color: string },
  ) {
    await this.requireManager(userId, spaceId);
    const name = this.normalizeName(input.name, 40);
    if (!name)
      throw new ConflictException('Informe um nome válido para o cargo.');
    const last = await this.prisma.spaceRole.findFirst({
      where: { spaceId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    try {
      return await this.prisma.spaceRole.create({
        data: {
          spaceId,
          name,
          color: input.color.toLowerCase(),
          position: (last?.position ?? 0) + 1,
        },
      });
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
    input: { name: string; color: string },
  ) {
    await this.requireManager(userId, spaceId);
    await this.requireSpaceRole(spaceId, roleId);
    const name = this.normalizeName(input.name, 40);
    if (!name)
      throw new ConflictException('Informe um nome válido para o cargo.');
    const role = await this.prisma.spaceRole.update({
      where: { id: roleId },
      data: { name, color: input.color.toLowerCase() },
    });
    await this.spaceChanges.notify(spaceId);
    return role;
  }

  async deleteRole(userId: string, spaceId: string, roleId: string) {
    await this.requireManager(userId, spaceId);
    await this.requireSpaceRole(spaceId, roleId);
    await this.prisma.$transaction([
      this.prisma.channelRoleAccess.deleteMany({
        where: { channel: { spaceId }, role: roleId },
      }),
      this.prisma.spaceRole.delete({ where: { id: roleId } }),
    ]);
    await this.spaceChanges.notify(spaceId);
    return { ok: true };
  }

  async updateMember(
    userId: string,
    spaceId: string,
    memberId: string,
    input: { role: string; roleIds: string[] },
  ) {
    await this.requireManager(userId, spaceId);
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
    await this.spaceChanges.notify(spaceId);
    return { id: memberId, role: input.role, roleIds };
  }

  async removeMember(userId: string, spaceId: string, memberId: string) {
    await this.requireManager(userId, spaceId);
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
    await this.spaceChanges.notify(spaceId);
    return { ok: true };
  }

  async renameChannel(
    userId: string,
    spaceId: string,
    channelId: string,
    value: string,
  ) {
    await this.requireManager(userId, spaceId);
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, spaceId },
      select: { kind: true },
    });
    if (!channel) throw new NotFoundException('Canal não encontrado.');
    const name = this.normalizeChannelName(value, channel.kind);
    if (!name)
      throw new ConflictException('Informe um nome válido para o canal.');
    const updated = await this.prisma.channel.update({
      where: { id: channelId },
      data: { name },
    });
    await this.spaceChanges.notify(spaceId);
    return updated;
  }

  async deleteChannel(userId: string, spaceId: string, channelId: string) {
    await this.requireManager(userId, spaceId);
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, spaceId },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException('Canal não encontrado.');
    await this.prisma.channel.delete({ where: { id: channelId } });
    await this.spaceChanges.notify(spaceId);
    return { ok: true };
  }

  async createChannel(
    userId: string,
    spaceId: string,
    input: { name: string; kind: ChannelKind },
  ) {
    await this.requireManager(userId, spaceId);
    const name = this.normalizeChannelName(input.name, input.kind);
    if (!name)
      throw new ConflictException('Informe um nome válido para o canal.');
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
          position: (lastChannel?.position ?? -1) + 1,
        },
      });
      await this.spaceChanges.notify(spaceId);
      return channel;
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException('Já existe um canal com esse nome.');
      }
      throw error;
    }
  }

  async createInvite(userId: string, spaceId: string) {
    await this.requireManager(userId, spaceId);
    return this.prisma.spaceInvite.create({
      data: {
        code: crypto.randomUUID().replaceAll('-', ''),
        spaceId,
        createdById: userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      select: { code: true, expiresAt: true },
    });
  }

  async channelAccess(userId: string, spaceId: string, channelId: string) {
    await this.requireManager(userId, spaceId);
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
    await this.requireManager(userId, spaceId);
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
    await this.spaceChanges.notify(spaceId);
    return { restricted: input.restricted, memberIds, roles };
  }

  async joinByInvite(userId: string, code: string) {
    const invite = await this.prisma.spaceInvite.findUnique({
      where: { code: code.trim() },
      include: { space: true },
    });
    if (!invite || (invite.expiresAt && invite.expiresAt <= new Date())) {
      throw new NotFoundException('Este convite não existe ou expirou.');
    }
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

  async spaceIdsForUser(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { spaceId: true },
    });
    return memberships.map((membership) => membership.spaceId);
  }

  async channelIdsForUser(userId: string) {
    const spaces = await this.listForUser(userId);
    return spaces.flatMap((space) =>
      space.channels.map((channel) => channel.id),
    );
  }

  private membershipsForUser(userId: string) {
    return this.prisma.membership.findMany({
      where: { userId },
      orderBy: { space: { createdAt: 'asc' } },
      include: {
        assignedRoles: { select: { roleId: true } },
        space: {
          include: {
            channels: {
              orderBy: { position: 'asc' },
              include: {
                memberAccess: { where: { userId }, select: { userId: true } },
                roleAccess: { select: { role: true } },
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

  private isUniqueConflict(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
