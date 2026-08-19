import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from './prisma.service';
import { SessionRegistry } from './session.registry';
import type { AuthSession, AuthUser, SessionPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionRegistry,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }) {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim().replace(/\s+/g, ' ');
    if (!displayName) {
      throw new ConflictException('Informe um nome de exibição válido.');
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Este e-mail já está em uso.');

    const sessionId = crypto.randomUUID();
    const authenticatedUser = await this.prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash: await hash(input.password, 12),
        activeSessionId: sessionId,
      },
      select: this.authenticatedUserSelect,
    });
    const user = this.toPublicUser(authenticatedUser);
    return { user, token: await this.issueToken(user, sessionId) };
  }

  async login(input: { email: string; password: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
    });
    if (!user || !(await compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }
    const sessionId = crypto.randomUUID();
    const authenticatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { activeSessionId: sessionId },
      select: this.authenticatedUserSelect,
    });
    await this.sessions.invalidateConnections(
      user.id,
      'Sua conta entrou em outro dispositivo. Entre novamente para continuar.',
    );
    const publicUser = this.toPublicUser(authenticatedUser);
    return {
      user: publicUser,
      token: await this.issueToken(publicUser, sessionId),
    };
  }

  async sessionFromToken(token?: string): Promise<AuthSession | null> {
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<SessionPayload>(token);
      if (!payload.sid) return null;
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: this.authenticatedUserSelect,
      });
      if (!user || user.activeSessionId !== payload.sid) return null;
      return { user: this.toPublicUser(user), sessionId: payload.sid };
    } catch {
      return null;
    }
  }

  async revokeSession(userId: string, sessionId: string) {
    const result = await this.prisma.user.updateMany({
      where: { id: userId, activeSessionId: sessionId },
      data: { activeSessionId: null },
    });
    if (result.count) {
      await this.sessions.invalidateConnections(
        userId,
        'Sua sessão foi encerrada.',
      );
    }
  }

  private issueToken(user: AuthUser, sessionId: string) {
    return this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      sid: sessionId,
    });
  }

  private toPublicUser(user: AuthUser & { activeSessionId: string | null }) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    };
  }

  private readonly authenticatedUserSelect = {
    id: true,
    email: true,
    displayName: true,
    avatarUrl: true,
    activeSessionId: true,
  } as const;
}
