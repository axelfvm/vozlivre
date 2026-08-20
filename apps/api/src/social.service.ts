import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChannelKind, FriendshipStatus, SpaceKind } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { SpaceChangeRegistry } from './space-change.registry';
import { SpacesService } from './spaces.service';
import { MediaService } from './media.service';

@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly spaceChanges: SpaceChangeRegistry,
    private readonly media: MediaService,
  ) {}

  async overview(userId: string) {
    const [friendships, blocked, directs] = await Promise.all([
      this.prisma.friendship.findMany({
        where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
        orderBy: { updatedAt: 'desc' },
        include: {
          requester: { select: this.userSelect },
          addressee: { select: this.userSelect },
        },
      }),
      this.prisma.userBlock.findMany({
        where: { blockerId: userId },
        orderBy: { createdAt: 'desc' },
        include: { blocked: { select: this.userSelect } },
      }),
      this.spaces.listPrivateForUser(userId),
    ]);
    const normalized = friendships.map((friendship) => ({
      id: friendship.id,
      status: friendship.status,
      direction:
        friendship.requesterId === userId
          ? ('outgoing' as const)
          : ('incoming' as const),
      user:
        friendship.requesterId === userId
          ? friendship.addressee
          : friendship.requester,
    }));
    return {
      friends: normalized.filter(
        (item) => item.status === FriendshipStatus.ACCEPTED,
      ),
      incoming: normalized.filter(
        (item) =>
          item.status === FriendshipStatus.PENDING &&
          item.direction === 'incoming',
      ),
      outgoing: normalized.filter(
        (item) =>
          item.status === FriendshipStatus.PENDING &&
          item.direction === 'outgoing',
      ),
      blocked: blocked.map((entry) => entry.blocked),
      directs,
    };
  }

  async searchUsers(userId: string, queryInput: string) {
    const query = queryInput.trim().slice(0, 80);
    if (query.length < 2) return [];
    const users = await this.prisma.user.findMany({
      where: {
        id: { not: userId },
        AND: [
          { blockedUsers: { none: { blockedId: userId } } },
          { blockedByUsers: { none: { blockerId: userId } } },
        ],
        OR: [
          { displayName: { contains: query, mode: 'insensitive' } },
          { email: { equals: query.toLowerCase() } },
        ],
      },
      take: 20,
      orderBy: { displayName: 'asc' },
      select: this.userSelect,
    });
    const relations = await this.prisma.friendship.findMany({
      where: {
        OR: [
          {
            requesterId: userId,
            addresseeId: { in: users.map((item) => item.id) },
          },
          {
            addresseeId: userId,
            requesterId: { in: users.map((item) => item.id) },
          },
        ],
      },
    });
    return users.map((user) => {
      const relation = relations.find(
        (item) => item.requesterId === user.id || item.addresseeId === user.id,
      );
      return {
        ...user,
        friendshipId: relation?.id ?? null,
        friendshipStatus: relation?.status ?? null,
        direction: relation
          ? relation.requesterId === userId
            ? 'outgoing'
            : 'incoming'
          : null,
      };
    });
  }

  async requestFriend(userId: string, addresseeId: string) {
    this.assertDifferentUsers(userId, addresseeId);
    await this.requireUser(addresseeId);
    if (await this.areBlocked(userId, addresseeId))
      throw new ForbiddenException('Não é possível enviar esta solicitação.');
    const reverse = await this.prisma.friendship.findUnique({
      where: {
        requesterId_addresseeId: {
          requesterId: addresseeId,
          addresseeId: userId,
        },
      },
    });
    if (reverse) {
      if (reverse.status === FriendshipStatus.ACCEPTED) return reverse;
      return this.prisma.friendship.update({
        where: { id: reverse.id },
        data: { status: FriendshipStatus.ACCEPTED },
      });
    }
    const existing = await this.prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: userId, addresseeId } },
    });
    if (existing) return existing;
    return this.prisma.friendship.create({
      data: { requesterId: userId, addresseeId },
    });
  }

  async acceptFriend(userId: string, friendshipId: string) {
    const result = await this.prisma.friendship.updateMany({
      where: {
        id: friendshipId,
        addresseeId: userId,
        status: FriendshipStatus.PENDING,
      },
      data: { status: FriendshipStatus.ACCEPTED },
    });
    if (!result.count)
      throw new NotFoundException('Solicitação não encontrada.');
    return { ok: true };
  }

  async removeFriend(userId: string, friendshipId: string) {
    const result = await this.prisma.friendship.deleteMany({
      where: {
        id: friendshipId,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
    });
    if (!result.count) throw new NotFoundException('Amizade não encontrada.');
    return { ok: true };
  }

  async block(userId: string, blockedId: string) {
    this.assertDifferentUsers(userId, blockedId);
    await this.requireUser(blockedId);
    await this.prisma.$transaction([
      this.prisma.userBlock.upsert({
        where: { blockerId_blockedId: { blockerId: userId, blockedId } },
        create: { blockerId: userId, blockedId },
        update: {},
      }),
      this.prisma.friendship.deleteMany({
        where: {
          OR: [
            { requesterId: userId, addresseeId: blockedId },
            { requesterId: blockedId, addresseeId: userId },
          ],
        },
      }),
    ]);
    return { ok: true };
  }

  async unblock(userId: string, blockedId: string) {
    await this.prisma.userBlock.deleteMany({
      where: { blockerId: userId, blockedId },
    });
    return { ok: true };
  }

  async createDirect(userId: string, otherId: string) {
    this.assertDifferentUsers(userId, otherId);
    if (!(await this.areFriends(userId, otherId)))
      throw new ForbiddenException(
        'Adicione esta pessoa como amiga antes de iniciar a conversa.',
      );
    if (await this.areBlocked(userId, otherId))
      throw new ForbiddenException('Não é possível iniciar esta conversa.');
    const dmKey = [userId, otherId].sort().join(':');
    const existing = await this.prisma.space.findUnique({ where: { dmKey } });
    if (existing) return this.spaces.privateSpaceForUser(userId, existing.id);
    const created = await this.prisma.space.create({
      data: {
        name: 'Conversa direta',
        kind: SpaceKind.DIRECT,
        dmKey,
        memberships: {
          create: [
            { userId, role: 'member' },
            { userId: otherId, role: 'member' },
          ],
        },
        channels: { create: { name: 'mensagens', kind: ChannelKind.TEXT } },
      },
    });
    await this.spaceChanges.notify(created.id);
    return this.spaces.privateSpaceForUser(userId, created.id);
  }

  async createGroup(
    userId: string,
    nameInput: string,
    memberIdsInput: string[],
  ) {
    const name = nameInput.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!name) throw new ConflictException('Informe um nome para o grupo.');
    const memberIds = [...new Set(memberIdsInput)]
      .filter((id) => id !== userId)
      .slice(0, 24);
    if (!memberIds.length)
      throw new ConflictException('Escolha ao menos uma pessoa.');
    const friendshipChecks = await Promise.all(
      memberIds.map((memberId) => this.areFriends(userId, memberId)),
    );
    if (friendshipChecks.some((value) => !value))
      throw new ForbiddenException('Grupos privados só podem incluir amigos.');
    const created = await this.prisma.space.create({
      data: {
        name,
        kind: SpaceKind.GROUP,
        memberships: {
          create: [
            { userId, role: 'owner' },
            ...memberIds.map((memberId) => ({
              userId: memberId,
              role: 'member',
            })),
          ],
        },
        channels: { create: { name: 'mensagens', kind: ChannelKind.TEXT } },
      },
    });
    await this.spaceChanges.notify(created.id);
    return this.spaces.privateSpaceForUser(userId, created.id);
  }

  async renameGroup(userId: string, spaceId: string, nameInput: string) {
    await this.requireGroupOwner(userId, spaceId);
    const name = nameInput.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!name) throw new ConflictException('Informe um nome válido.');
    await this.prisma.space.update({ where: { id: spaceId }, data: { name } });
    await this.spaceChanges.notify(spaceId);
    return this.spaces.privateSpaceForUser(userId, spaceId);
  }

  async addGroupMember(userId: string, spaceId: string, memberId: string) {
    await this.requireGroupOwner(userId, spaceId);
    const existing = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId: memberId, spaceId } },
      select: { userId: true },
    });
    if (existing) return { ok: true };
    const memberCount = await this.prisma.membership.count({
      where: { spaceId },
    });
    if (memberCount >= 25)
      throw new ConflictException('O grupo atingiu o limite de 25 pessoas.');
    if (!(await this.areFriends(userId, memberId)))
      throw new ForbiddenException('Somente amigos podem ser adicionados.');
    await this.prisma.membership.upsert({
      where: { userId_spaceId: { userId: memberId, spaceId } },
      create: { userId: memberId, spaceId, role: 'member' },
      update: {},
    });
    await this.spaceChanges.notify(spaceId);
    return { ok: true };
  }

  async deleteGroup(userId: string, spaceId: string) {
    await this.requireGroupOwner(userId, spaceId);
    const storedNames = await this.media.spaceUploads(spaceId);
    await this.prisma.space.delete({ where: { id: spaceId } });
    await this.media.removeMany(storedNames);
    await this.spaceChanges.notify(spaceId);
    return { ok: true };
  }

  async removeGroupMember(userId: string, spaceId: string, memberId: string) {
    if (userId !== memberId) await this.requireGroupOwner(userId, spaceId);
    const membership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId: memberId, spaceId } },
      select: { role: true },
    });
    if (!membership)
      throw new NotFoundException('Pessoa não encontrada no grupo.');
    if (membership.role === 'owner')
      throw new ForbiddenException(
        'O proprietário não pode sair sem excluir o grupo.',
      );
    await this.prisma.membership.delete({
      where: { userId_spaceId: { userId: memberId, spaceId } },
    });
    await this.spaceChanges.notify(spaceId);
    return { ok: true };
  }

  private async areFriends(left: string, right: string) {
    return Boolean(
      await this.prisma.friendship.findFirst({
        where: {
          status: FriendshipStatus.ACCEPTED,
          OR: [
            { requesterId: left, addresseeId: right },
            { requesterId: right, addresseeId: left },
          ],
        },
        select: { id: true },
      }),
    );
  }

  private async areBlocked(left: string, right: string) {
    return Boolean(
      await this.prisma.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: left, blockedId: right },
            { blockerId: right, blockedId: left },
          ],
        },
        select: { blockerId: true },
      }),
    );
  }

  private async requireGroupOwner(userId: string, spaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
      select: { role: true, space: { select: { kind: true } } },
    });
    if (
      membership?.space.kind !== SpaceKind.GROUP ||
      membership.role !== 'owner'
    )
      throw new ForbiddenException(
        'Somente o proprietário do grupo pode fazer isso.',
      );
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Pessoa não encontrada.');
  }

  private assertDifferentUsers(left: string, right: string) {
    if (left === right) throw new ConflictException('Escolha outra pessoa.');
  }

  private readonly userSelect = {
    id: true,
    displayName: true,
    avatarUrl: true,
    status: true,
  } as const;
}
