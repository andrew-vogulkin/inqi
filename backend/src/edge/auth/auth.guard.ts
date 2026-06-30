import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { UnauthorizedError } from '../../common/errors';
import { AuthUser } from './auth.tokens';
import { SessionService } from './session.service';

/** Extract + verify the Bearer session, returning the principal (typed 401 on failure). */
export function authenticate({ req, session }: { req: Request; session: SessionService }): AuthUser {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthorizedError({ message: 'authentication required (Bearer token)' });
  }
  return session.verify(header.slice('Bearer '.length).trim()); // throws AUTH_TOKEN_EXPIRED / AUTH_INVALID_TOKEN
}

/**
 * Real auth (HP-10): verifies the signed session and attaches `req.user`. Applied
 * to private endpoints; capability-token + public surfaces stay open.
 * (The `canActivate(context)` signature is mandated by Nest's CanActivate contract.)
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly session: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    (req as Request & { user: AuthUser }).user = authenticate({ req, session: this.session });
    return true;
  }
}
