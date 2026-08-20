import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { SessionRegistry } from './session.registry';
import type {
  AuthSession,
  AuthUser,
  SessionPayload,
  UserSettings,
} from './auth.types';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  totpUri,
  verifyTotp,
} from './totp';

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  compactMode: false,
  reducedMotion: false,
  desktopNotifications: true,
  notificationSound: true,
  mentionNotifications: true,
  inputDeviceId: '',
  outputDeviceId: '',
  cameraDeviceId: '',
  inputVolume: 100,
  outputVolume: 100,
  screenQuality: '1080p',
};

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
    if (user.totpEnabled) {
      return {
        requiresTwoFactor: true as const,
        challengeToken: await this.jwt.signAsync(
          { sub: user.id, purpose: 'two-factor' },
          { expiresIn: '5m' },
        ),
      };
    }
    return this.completeLogin(user.id);
  }

  async completeTwoFactor(challengeToken: string, code: string) {
    let payload: { sub: string; purpose?: string };
    try {
      payload = await this.jwt.verifyAsync(challengeToken);
    } catch {
      throw new UnauthorizedException(
        'A verificação expirou. Entre novamente.',
      );
    }
    if (payload.purpose !== 'two-factor')
      throw new UnauthorizedException('Verificação inválida.');
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        totpEnabled: true,
        totpSecret: true,
        recoveryCodeHashes: true,
      },
    });
    if (!user?.totpEnabled || !user.totpSecret)
      throw new UnauthorizedException(
        'A verificação em duas etapas não está ativa.',
      );

    const normalized = normalizeRecoveryCode(code);
    const recoveryHash = hashRecoveryCode(code);
    const recoveryIndex = user.recoveryCodeHashes.findIndex((value) =>
      this.safeHashEqual(value, recoveryHash),
    );
    const validTotp = verifyTotp(user.totpSecret, code);
    if (!validTotp && recoveryIndex < 0)
      throw new UnauthorizedException('Código de verificação incorreto.');
    if (!validTotp && !normalized)
      throw new UnauthorizedException('Código de verificação incorreto.');
    if (recoveryIndex >= 0) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          recoveryCodeHashes: user.recoveryCodeHashes.filter(
            (_value, index) => index !== recoveryIndex,
          ),
        },
      });
    }
    return this.completeLogin(user.id);
  }

  async beginTwoFactorSetup(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret, totpEnabled: false, recoveryCodeHashes: [] },
    });
    return { secret, otpauthUri: totpUri(secret, user.email) };
  }

  async enableTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpSecret: true },
    });
    if (!user.totpSecret || !verifyTotp(user.totpSecret, code))
      throw new UnauthorizedException('Código de verificação incorreto.');
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabled: true,
        recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
      },
    });
    return { ok: true, recoveryCodes };
  }

  async disableTwoFactor(userId: string, password: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, totpSecret: true, totpEnabled: true },
    });
    if (!(await compare(password, user.passwordHash)))
      throw new UnauthorizedException('A senha atual está incorreta.');
    if (
      !user.totpEnabled ||
      !user.totpSecret ||
      !verifyTotp(user.totpSecret, code)
    )
      throw new UnauthorizedException('Código de verificação incorreto.');
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null, recoveryCodeHashes: [] },
    });
    return { ok: true };
  }

  private async completeLogin(userId: string) {
    const sessionId = crypto.randomUUID();
    const authenticatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { activeSessionId: sessionId },
      select: this.authenticatedUserSelect,
    });
    await this.sessions.invalidateConnections(
      userId,
      'Sua conta entrou em outro dispositivo. Entre novamente para continuar.',
    );
    const publicUser = this.toPublicUser(authenticatedUser);
    return {
      requiresTwoFactor: false as const,
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

  async updateProfile(
    userId: string,
    input: { displayName: string; bio?: string; status?: string },
  ) {
    const displayName = input.displayName.trim().replace(/\s+/g, ' ');
    if (!displayName)
      throw new ConflictException('Informe um nome de exibição válido.');
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName,
        bio: input.bio?.trim().slice(0, 190) ?? undefined,
        status: input.status?.trim().slice(0, 80) ?? undefined,
      },
      select: this.authenticatedUserSelect,
    });
    return { user: this.toPublicUser(user) };
  }

  async updateSettings(userId: string, input: Partial<UserSettings>) {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { settings: true },
    });
    const settings = {
      ...DEFAULT_SETTINGS,
      ...(current.settings as Partial<UserSettings>),
      ...input,
    };
    await this.prisma.user.update({
      where: { id: userId },
      data: { settings },
    });
    return { settings };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user || !(await compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('A senha atual está incorreta.');
    }
    if (await compare(newPassword, user.passwordHash)) {
      throw new ConflictException('A nova senha deve ser diferente da atual.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hash(newPassword, 12) },
    });
    return { ok: true };
  }

  private issueToken(user: AuthUser, sessionId: string) {
    return this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      sid: sessionId,
    });
  }

  private toPublicUser(user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string;
    status: string;
    settings: unknown;
    activeSessionId: string | null;
    totpEnabled: boolean;
  }): AuthUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      status: user.status,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(typeof user.settings === 'object' &&
        user.settings &&
        !Array.isArray(user.settings)
          ? (user.settings as Partial<UserSettings>)
          : {}),
      },
      twoFactorEnabled: user.totpEnabled,
    };
  }

  private safeHashEqual(left: string, right: string) {
    const a = createHash('sha256').update(left).digest();
    const b = createHash('sha256').update(right).digest();
    return timingSafeEqual(a, b);
  }

  private readonly authenticatedUserSelect = {
    id: true,
    email: true,
    displayName: true,
    avatarUrl: true,
    bio: true,
    status: true,
    settings: true,
    activeSessionId: true,
    totpEnabled: true,
  } as const;
}
