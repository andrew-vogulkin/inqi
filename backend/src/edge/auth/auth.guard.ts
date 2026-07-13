import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ErrorCode, ForbiddenError, UnauthorizedError } from '../../common/errors';
import { CustomerService } from '../../domain/customer/customer.service';
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
 *
 * HP-25: also rejects a **suspended** account on every request (immediate lockout —
 * a token minted before suspension stops working now, not at its 8h TTL). Admins are
 * never suspendable, so this check only ever gates customer surfaces.
 * (The `canActivate(context)` signature is mandated by Nest's CanActivate contract.)
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly session: SessionService, private readonly customers: CustomerService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const user = authenticate({ req, session: this.session });
    if (await this.customers.isSuspended({ id: user.sub })) {
      throw new ForbiddenError({ code: ErrorCode.AccountSuspended, message: 'this account is suspended' });
    }
    (req as Request & { user: AuthUser }).user = user;
    return true;
  }
}
