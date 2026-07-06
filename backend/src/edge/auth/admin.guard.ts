import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthRole } from '@inqi/shared';
import { ForbiddenError } from '../../common/errors';
import { AuthUser } from './auth.tokens';
import { SessionService } from './session.service';
import { authenticate } from './auth.guard';

/**
 * Admin-only guard (HP-10): authenticates (so it works standalone) then requires
 * the admin role. 401 if unauthenticated, 403 if a non-admin. Reuses `req.user`
 * when an earlier {@link AuthGuard} already populated it.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly session: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user ?? authenticate({ req, session: this.session });
    if (user.role !== AuthRole.Admin) {
      throw new ForbiddenError({ message: 'admin role required' });
    }
    req.user = user;
    return true;
  }
}
