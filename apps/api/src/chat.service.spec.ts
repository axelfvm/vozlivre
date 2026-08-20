import { ChannelKind } from '@prisma/client';
import { ChatService } from './chat.service';
import { PrismaService } from './prisma.service';
import { SpacesService } from './spaces.service';
import { MediaService } from './media.service';
import { ChatEventRegistry } from './chat-event.registry';

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
    space: {
      findUnique: jest.fn().mockResolvedValue({
        kind: 'COMMUNITY',
        memberships: [{ userId: 'user-1' }],
      }),
    },
    userBlock: { findFirst: jest.fn() },
    messageReaction: reactionRepository,
    messageAttachment: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
    messageMention: { deleteMany: jest.fn() },
    membership: { findMany: jest.fn() },
    spaceRole: { findMany: jest.fn() },
    spaceSticker: { findFirst: jest.fn() },
    channelReadState: { upsert: jest.fn() },
    $transaction: jest.fn((callback: (value: unknown) => unknown) =>
      callback({
        message: messageRepository,
        messageMention: { deleteMany: jest.fn() },
        messageAttachment: { updateMany: jest.fn() },
      }),
    ),
  } as unknown as PrismaService;
  const accessibleChannel = jest.fn();
  const spaces = {
    accessibleChannel,
    hasPermission: jest.fn(),
  } as unknown as SpacesService;
  const media = {
    remove: jest.fn(),
    removeMany: jest.fn(),
  } as unknown as MediaService;
  const events = { notify: jest.fn() } as unknown as ChatEventRegistry;
  const service = new ChatService(prisma, spaces, media, events);

  beforeEach(() => {
    jest.clearAllMocks();
    accessibleChannel.mockResolvedValue({ spaceId: 'space-1' });
    (spaces.hasPermission as jest.Mock).mockResolvedValue(true);
  });

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
          authorAvatarUrl: null,
          body: 'Mensagem persistida',
          pinnedAt: null,
          createdAt: createdAt.toISOString(),
          editedAt: null,
          replyTo: null,
          reactions: [],
          attachments: [],
          mentions: [],
          sticker: null,
          thread: null,
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
      pinnedAt: null,
      createdAt,
      editedAt: null,
      author: { displayName: 'Axel' },
      replyTo: null,
      reactions: [],
      attachments: [],
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
      authorAvatarUrl: null,
      body: 'Olá, VozLivre!',
      pinnedAt: null,
      createdAt: createdAt.toISOString(),
      editedAt: null,
      replyTo: null,
      reactions: [],
      attachments: [],
      mentions: [],
      sticker: null,
      thread: null,
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
    messageRepository.findUniqueOrThrow.mockResolvedValue({
      id: 'message-1',
      channelId: 'channel-1',
      authorId: 'user-1',
      body: 'Texto editado',
      pinnedAt: null,
      createdAt,
      editedAt: createdAt,
      author: { displayName: 'Axel', avatarUrl: null },
      replyTo: null,
      reactions: [],
      attachments: [],
      mentions: [],
      sticker: null,
      thread: null,
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
