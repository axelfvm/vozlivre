import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChannelKind } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class SpacesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string) {
    const memberships = await this.membershipsForUser(userId);
    return memberships.map((membership) => ({
      id: membership.space.id,
      name: membership.space.name,
      role: membership.role,
      channels: membership.space.channels
        .filter((channel) =>
          this.membershipCanAccessChannel(membership.role, userId, channel),
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
      return await this.prisma.channel.create({
        data: {
          spaceId,
          name,
          kind: input.kind,
          position: (lastChannel?.position ?? -1) + 1,
        },
      });
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
    const roles = [...new Set(input.roles)].filter((role) =>
      ['owner', 'admin', 'member'].includes(role),
    );
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
              select: { role: true },
            },
          },
        },
      },
    });
    const membership = channel?.space.memberships[0];
    if (
      !channel ||
      !membership ||
      !this.membershipCanAccessChannel(membership.role, userId, channel)
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
        space: {
          include: {
            channels: {
              orderBy: { position: 'asc' },
              include: {
                memberAccess: { where: { userId }, select: { userId: true } },
                roleAccess: { select: { role: true } },
              },
            },
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

  private membershipCanAccessChannel(
    role: string,
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
      channel.roleAccess.some((access) => access.role === role)
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
