import { ChannelKind } from '@prisma/client';
import { ChatService } from './chat.service';
import { PrismaService } from './prisma.service';
import { SpacesService } from './spaces.service';

describe('ChatService', () => {
  const messageRepository = {
    findMany: jest.fn(),
    create: jest.fn(),
  };
  const prisma = { message: messageRepository } as unknown as PrismaService;
  const accessibleChannel = jest.fn();
  const spaces = {
    accessibleChannel,
  } as unknown as SpacesService;
  const service = new ChatService(prisma, spaces);

  beforeEach(() => jest.clearAllMocks());

  it('loads persisted channel messages in chronological order', async () => {
    const createdAt = new Date('2026-08-19T18:00:00.000Z');
    messageRepository.findMany.mockResolvedValue([
      {
        id: 'message-1',
        channelId: 'channel-1',
        body: 'Mensagem persistida',
        createdAt,
        author: { displayName: 'Axel' },
      },
    ]);

    await expect(service.history('user-1', 'channel-1')).resolves.toEqual([
      {
        id: 'message-1',
        channelId: 'channel-1',
        author: 'Axel',
        body: 'Mensagem persistida',
        createdAt: createdAt.toISOString(),
      },
    ]);
    expect(accessibleChannel).toHaveBeenCalledWith(
      'user-1',
      'channel-1',
      ChannelKind.TEXT,
    );
    expect(messageRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: 'channel-1' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('persists a sanitized message before returning it to the gateway', async () => {
    const createdAt = new Date('2026-08-19T18:05:00.000Z');
    messageRepository.create.mockResolvedValue({
      id: 'message-2',
      channelId: 'channel-1',
      body: 'Olá, VozLivre!',
      createdAt,
      author: { displayName: 'Axel' },
    });

    await expect(
      service.create('user-1', {
        channelId: 'channel-1',
        body: '  Olá, VozLivre!  ',
      }),
    ).resolves.toEqual({
      id: 'message-2',
      channelId: 'channel-1',
      author: 'Axel',
      body: 'Olá, VozLivre!',
      createdAt: createdAt.toISOString(),
    });
    expect(messageRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          channelId: 'channel-1',
          authorId: 'user-1',
          body: 'Olá, VozLivre!',
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
});
