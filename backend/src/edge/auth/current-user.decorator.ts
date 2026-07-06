import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './auth.tokens';

/** Inject the authenticated principal set by {@link AuthGuard}/{@link AdminGuard}. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
