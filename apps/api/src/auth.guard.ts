import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';

export type AuthenticatedRequest = Request & {
  user: AuthUser;
  sessionId: string;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = request.cookies as
      Record<string, string | undefined> | undefined;
    const session = await this.auth.sessionFromToken(cookies?.vozlivre_session);
    if (!session) throw new UnauthorizedException('Faça login para continuar.');
    request.user = session.user;
    request.sessionId = session.sessionId;
    return true;
  }
}
