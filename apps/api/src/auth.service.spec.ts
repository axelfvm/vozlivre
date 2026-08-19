import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';
import { SessionRegistry } from './session.registry';

describe('AuthService', () => {
  const userRepository = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const prisma = { user: userRepository } as unknown as PrismaService;
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('signed-token'),
    verifyAsync: jest.fn(),
  } as unknown as JwtService;
  const sessionRegistry = {
    invalidateConnections: jest.fn(),
  } as unknown as SessionRegistry;
  const service = new AuthService(prisma, jwt, sessionRegistry);

  beforeEach(() => jest.clearAllMocks());

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

    expect(sessionRegistry.invalidateConnections).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('outro dispositivo'),
    );
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1', sid: expect.any(String) }),
    );
  });

  it('rejects a token that is no longer the active session', async () => {
    (jwt.verifyAsync as jest.Mock).mockResolvedValue({
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
