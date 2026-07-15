import { AuthService } from './auth.service';
import { MfaCodeStore } from './mfa-code.store';

type MfaCfg = { transport: 'mock' | 'email'; mockCode: string; codeTtlMs: number; from?: string };

/** Minimal fakes — the sign-in path only needs these seams. `existing` decides whether
 *  findByEmail (only hit for plus-aliased addresses) reports an established account. */
function build(mfa: MfaCfg, { existing = false }: { existing?: boolean } = {}) {
  const mail = { sent: [] as Array<{ to?: string | null; subject: string; body: string }> , async send(args: never) { this.sent.push(args); return { externalId: 'x' }; } };
  const config = { mfa } as never;
  const prisma = { async $transaction(fn: (tx: unknown) => unknown) { return fn({}); } } as never;
  const customers = {
    async upsertByEmail({ email }: { email: string }) { return { id: 'c1', email, name: null, role: 'customer' }; },
    async findByEmail({ email }: { email: string }) { return existing ? { id: 'c1', email } : null; },
    // refresh re-reads the customer (role is DB-authoritative): return a promoted admin with a name.
    async findById({ id }: { id: string }) { return { id, email: 'ada@example.com', name: 'Ada', role: 'admin' }; },
  } as never;
  const reports = { async linkOwnerByEmail() { return { count: 0 }; } } as never;
  const session = { sign: () => 'signed-token' } as never;
  const svc = new AuthService(prisma, config, customers, reports, session, new MfaCodeStore(), mail as never);
  return { svc, mail };
}

const codeFrom = (body: string) => (body.match(/\b(\d{6})\b/) ?? [])[1];

describe('AuthService MFA transport', () => {
  describe('mock (default)', () => {
    const cfg: MfaCfg = { transport: 'mock', mockCode: '123456', codeTtlMs: 600_000 };

    it('does not email and accepts the fixed code', async () => {
      const { svc, mail } = build(cfg);
      await svc.startEmailSignIn({ email: 'Ada@Example.com' });
      expect(mail.sent).toHaveLength(0);
      const res = await svc.verifyEmailSignIn({ email: 'ada@example.com', code: '123456' });
      expect(res.token).toBe('signed-token');
    });

    it('rejects a wrong code', async () => {
      const { svc } = build(cfg);
      await expect(svc.verifyEmailSignIn({ email: 'ada@example.com', code: '000000' })).rejects.toThrow();
    });
  });

  describe('email', () => {
    const cfg: MfaCfg = { transport: 'email', mockCode: '123456', codeTtlMs: 600_000, from: 'marlowe.v@monkeycode.io' };

    it('emails a fresh code that then verifies; the mock code no longer works', async () => {
      const { svc, mail } = build(cfg);
      await svc.startEmailSignIn({ email: 'Ada@Example.com' });
      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0].to).toBe('ada@example.com');
      const code = codeFrom(mail.sent[0].body);
      expect(code).toMatch(/^\d{6}$/);
      // the fixed mock code must NOT be accepted in email mode
      await expect(svc.verifyEmailSignIn({ email: 'ada@example.com', code: '123456' })).rejects.toThrow();
      // the emailed code works (re-issue first, since the failed attempt above consumed an attempt but not the code)
      const res = await svc.verifyEmailSignIn({ email: 'ada@example.com', code: code! });
      expect(res.token).toBe('signed-token');
    });
  });

  // Anti multi-registration: a `you+tag@host` address delivers to the same inbox as
  // `you@host`, so one person could farm the per-account credit grant with endless aliases.
  describe('plus-alias guard (new-account creation)', () => {
    const cfg: MfaCfg = { transport: 'mock', mockCode: '123456', codeTtlMs: 600_000 };

    it('refuses a NEW account whose email carries a + sub-address', async () => {
      const { svc } = build(cfg, { existing: false });
      await expect(svc.verifyEmailSignIn({ email: 'zerc+spam1@gmail.com', code: '123456' }))
        .rejects.toMatchObject({ code: 'EMAIL_ALIAS_NOT_ALLOWED' });
    });

    it('still lets an EXISTING aliased account sign in (e.g. a deliberately-created admin)', async () => {
      const { svc } = build(cfg, { existing: true });
      const res = await svc.verifyEmailSignIn({ email: 'yywhywhywhywhy+admin@gmail.com', code: '123456' });
      expect(res.token).toBe('signed-token');
    });

    it('leaves plain addresses (no +) untouched', async () => {
      const { svc } = build(cfg, { existing: false });
      const res = await svc.verifyEmailSignIn({ email: 'ada@example.com', code: '123456' });
      expect(res.token).toBe('signed-token');
    });

    it('checks the alias only AFTER the code verifies (a wrong code never reveals account state)', async () => {
      const { svc } = build(cfg, { existing: false });
      await expect(svc.verifyEmailSignIn({ email: 'zerc+spam@gmail.com', code: '000000' }))
        .rejects.toMatchObject({ code: 'AUTH_INVALID_CODE' }); // invalid-code wins, not the alias error
    });
  });

  describe('refresh (session prolongation)', () => {
    const cfg: MfaCfg = { transport: 'mock', mockCode: '123456', codeTtlMs: 600_000 };

    it('re-issues a token and re-reads the role from the DB', async () => {
      const { svc } = build(cfg);
      const res = await svc.refresh({ user: { sub: 'c1', email: 'ada@example.com', role: 'customer' } as never });
      expect(res.token).toBe('signed-token');                 // a fresh token was signed
      expect(res.customer).toEqual({ id: 'c1', email: 'ada@example.com', name: 'Ada', role: 'admin' }); // role from DB, not the stale token
    });
  });
});
