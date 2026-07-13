import { ExecutionContext } from '@nestjs/common';
import { AuthRole } from '@inqi/shared';
import { DomainError, ErrorCode } from '../../common/errors';
import { AuthGuard } from './auth.guard';

/** A request carrying a Bearer header (the token itself is verified by the stub session). */
function ctx(): ExecutionContext {
  const req: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: 'Bearer tok' } };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

const claims = { sub: 'c1', email: 'ada@x.io', role: AuthRole.Customer };

describe('AuthGuard suspension enforcement (HP-25)', () => {
  it('passes an active account and attaches req.user', async () => {
    const session = { verify: jest.fn().mockReturnValue(claims) };
    const customers = { isSuspended: jest.fn().mockResolvedValue(false) };
    const guard = new AuthGuard(session as never, customers as never);
    const c = ctx();
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(customers.isSuspended).toHaveBeenCalledWith({ id: 'c1' });
  });

  it('rejects a suspended account with ACCOUNT_SUSPENDED (403)', async () => {
    const session = { verify: jest.fn().mockReturnValue(claims) };
    const customers = { isSuspended: jest.fn().mockResolvedValue(true) };
    const guard = new AuthGuard(session as never, customers as never);
    await expect(guard.canActivate(ctx())).rejects.toMatchObject({ code: ErrorCode.AccountSuspended });
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(DomainError);
  });
});
