import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';
import { SessionRegistry } from './session.registry';

describe('AuthService', () => {
  const signAsyncMock = jest.fn().mockResolvedValue('signed-token');
  const verifyAsyncMock = jest.fn<(token: string) => Promise<unknown>>();
  const invalidateConnectionsMock = jest
    .fn<(userId: string, message: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const userRepository = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const prisma = { user: userRepository } as unknown as PrismaService;
  const jwt = {
    signAsync: signAsyncMock,
    verifyAsync: verifyAsyncMock,
  } as unknown as JwtService;
  const sessionRegistry = {
    invalidateConnections: invalidateConnectionsMock,
  } as unknown as SessionRegistry;
  const service = new AuthService(prisma, jwt, sessionRegistry);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes e-mail and never persists the plain password', async () => {
    userRepository.findUnique.mockResolvedValue(null);
    userRepository.create.mockImplementation(
      ({ data }: { data: Record<string, string> }) => ({
        id: 'user-1',
        email: data.email,
        displayName: data.displayName,
        avatarUrl: null,
        activeSessionId: data.activeSessionId,
      }),
    );

    const result = await service.register({
      displayName: 'Axel',
      email: '  TESTE@EXAMPLE.COM ',
      password: 'senha-segura',
    });

    // The repository is intentionally a lightweight Prisma test double.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const persisted = userRepository.create.mock.calls[0][0].data as Record<
      string,
      string
    >;
    expect(result.user.email).toBe('teste@example.com');
    expect(persisted.passwordHash).not.toBe('senha-segura');
    expect(persisted.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('rejects an e-mail that is already registered', async () => {
    userRepository.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(
      service.register({
        displayName: 'Outra pessoa',
        email: 'teste@example.com',
        password: 'senha-segura',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('invalidates the previous session when the same account logs in again', async () => {
    userRepository.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'teste@example.com',
      displayName: 'Axel',
      avatarUrl: null,
      passwordHash: await hash('senha-segura', 4),
      activeSessionId: 'old-session',
    });
    userRepository.update.mockImplementation(
      ({ data }: { data: { activeSessionId: string } }) => ({
        id: 'user-1',
        email: 'teste@example.com',
        displayName: 'Axel',
        avatarUrl: null,
        activeSessionId: data.activeSessionId,
      }),
    );

    await service.login({
      email: 'teste@example.com',
      password: 'senha-segura',
    });

    expect(invalidateConnectionsMock).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('outro dispositivo'),
    );
    expect(signAsyncMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a token that is no longer the active session', async () => {
    verifyAsyncMock.mockResolvedValue({
      sub: 'user-1',
      email: 'teste@example.com',
      sid: 'old-session',
    });
    userRepository.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'teste@example.com',
      displayName: 'Axel',
      avatarUrl: null,
      activeSessionId: 'new-session',
    });

    await expect(service.sessionFromToken('old-token')).resolves.toBeNull();
  });
});
