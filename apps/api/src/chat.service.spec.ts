import { ChannelKind } from '@prisma/client';
import { ChatService } from './chat.service';
import { PrismaService } from './prisma.service';
import { SpacesService } from './spaces.service';

describe('ChatService', () => {
  const messageRepository = {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const reactionRepository = {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };
  const prisma = {
    message: messageRepository,
    messageReaction: reactionRepository,
  } as unknown as PrismaService;
  const accessibleChannel = jest.fn();
  const spaces = {
    accessibleChannel,
    canManageSpace: jest.fn(),
  } as unknown as SpacesService;
  const service = new ChatService(prisma, spaces);

  beforeEach(() => jest.clearAllMocks());

  it('loads persisted channel messages in chronological order', async () => {
    const createdAt = new Date('2026-08-19T18:00:00.000Z');
    messageRepository.findMany.mockResolvedValue([
      {
        id: 'message-1',
        channelId: 'channel-1',
        authorId: 'user-1',
        body: 'Mensagem persistida',
        createdAt,
        editedAt: null,
        author: { displayName: 'Axel' },
        replyTo: null,
        reactions: [],
      },
    ]);

    await expect(service.history('user-1', 'channel-1')).resolves.toEqual({
      hasMore: false,
      messages: [
        {
          id: 'message-1',
          channelId: 'channel-1',
          authorId: 'user-1',
          author: 'Axel',
          body: 'Mensagem persistida',
          createdAt: createdAt.toISOString(),
          editedAt: null,
          replyTo: null,
          reactions: [],
        },
      ],
    });
    expect(accessibleChannel).toHaveBeenCalledWith(
      'user-1',
      'channel-1',
      ChannelKind.TEXT,
    );
    expect(messageRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: 'channel-1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51,
      }),
    );
  });

  it('persists a sanitized message before returning it to the gateway', async () => {
    const createdAt = new Date('2026-08-19T18:05:00.000Z');
    messageRepository.create.mockResolvedValue({
      id: 'message-2',
      channelId: 'channel-1',
      authorId: 'user-1',
      body: 'Olá, VozLivre!',
      createdAt,
      editedAt: null,
      author: { displayName: 'Axel' },
      replyTo: null,
      reactions: [],
    });

    await expect(
      service.create('user-1', {
        channelId: 'channel-1',
        body: '  Olá, VozLivre!  ',
      }),
    ).resolves.toEqual({
      id: 'message-2',
      channelId: 'channel-1',
      authorId: 'user-1',
      author: 'Axel',
      body: 'Olá, VozLivre!',
      createdAt: createdAt.toISOString(),
      editedAt: null,
      replyTo: null,
      reactions: [],
    });
    expect(messageRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          channelId: 'channel-1',
          authorId: 'user-1',
          body: 'Olá, VozLivre!',
          replyToId: undefined,
        },
      }),
    );
  });

  it('does not persist empty or invalid message bodies', async () => {
    await expect(
      service.create('user-1', { channelId: 'channel-1', body: '   ' }),
    ).resolves.toBeNull();
    await expect(
      service.create('user-1', { channelId: 'channel-1', body: null }),
    ).resolves.toBeNull();
    expect(messageRepository.create).not.toHaveBeenCalled();
  });

  it('edits only the author message and records the edit time', async () => {
    const createdAt = new Date('2026-08-19T18:05:00.000Z');
    messageRepository.findUnique.mockResolvedValue({
      authorId: 'user-1',
      channelId: 'channel-1',
      channel: { spaceId: 'space-1' },
    });
    messageRepository.update.mockResolvedValue({
      id: 'message-1',
      channelId: 'channel-1',
      authorId: 'user-1',
      body: 'Texto editado',
      createdAt,
      editedAt: createdAt,
      author: { displayName: 'Axel' },
      replyTo: null,
      reactions: [],
    });
    await expect(
      service.edit('user-1', 'message-1', ' Texto editado '),
    ).resolves.toMatchObject({
      body: 'Texto editado',
      editedAt: createdAt.toISOString(),
    });
    expect(messageRepository.update).toHaveBeenCalledTimes(1);
  });

  it('toggles a persisted reaction and returns its aggregate', async () => {
    const createdAt = new Date('2026-08-19T18:05:00.000Z');
    messageRepository.findUnique.mockResolvedValue({
      authorId: 'user-2',
      channelId: 'channel-1',
      channel: { spaceId: 'space-1' },
    });
    reactionRepository.findUnique.mockResolvedValue(null);
    messageRepository.findUniqueOrThrow.mockResolvedValue({
      id: 'message-1',
      channelId: 'channel-1',
      authorId: 'user-2',
      body: 'Olá',
      createdAt,
      editedAt: null,
      author: { displayName: 'Outra pessoa' },
      replyTo: null,
      reactions: [{ emoji: '👍', userId: 'user-1' }],
    });
    await expect(
      service.toggleReaction('user-1', 'message-1', '👍'),
    ).resolves.toMatchObject({
      message: { reactions: [{ emoji: '👍', count: 1, userIds: ['user-1'] }] },
    });
    expect(reactionRepository.create).toHaveBeenCalledWith({
      data: { messageId: 'message-1', userId: 'user-1', emoji: '👍' },
    });
  });
});
