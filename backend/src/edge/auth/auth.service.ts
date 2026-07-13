import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthRole } from '@inqi/shared';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { ConfigService } from '../../infra/config/config.service';
import { ErrorCode, ForbiddenError, UnauthorizedError } from '../../common/errors';
import { CustomerService } from '../../domain/customer/customer.service';
import { ReportService } from '../../domain/report/report.service';
import { MAIL_PROVIDER, MailProvider } from '../../domain/source/mail.provider';
import { AuthUser } from './auth.tokens';
import { SessionService } from './session.service';
import { MfaCodeStore } from './mfa-code.store';

export interface SignInResult {
  token: string;
  customer: { id: string; email: string; name?: string | null; role: AuthRole };
}

/**
 * Two-step email sign-in: the customer submits their email (step 1 — a
 * verification code is issued; transport is MOCKED for now, the code is
 * `config.mfa.mockCode`), then submits the code (step 2) — on match we upsert
 * the Customer by email, claim any reports submitted with that address, and
 * issue a signed session.
 *
 * **Roles are owned by the database.** Admins are marked manually
 * (`UPDATE "Customer" SET role='admin' WHERE email=…`, or `pnpm db:promote-admin`);
 * a sign-in NEVER changes an existing role. The session's role is read straight from
 * the persisted Customer, so the DB is the single source of truth.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly customers: CustomerService,
    private readonly reports: ReportService,
    private readonly session: SessionService,
    private readonly mfaCodes: MfaCodeStore,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
  ) {}

  /**
   * Step 1: issue the verification code. `email` transport emails a per-attempt
   * random code (via MAIL_PROVIDER); `mock` transport just logs the fixed code.
   */
  async startEmailSignIn({ email }: { email: string }): Promise<{ sent: boolean }> {
    const normalized = email.trim().toLowerCase();
    const mfa = this.config.mfa;
    if (mfa.transport === 'email') {
      const code = this.mfaCodes.issue({ email: normalized, ttlMs: mfa.codeTtlMs, now: Date.now() });
      await this.mail.send({
        from: mfa.from ?? 'no-reply@monkeycode.io',
        to: normalized,
        subject: 'Your inqi sign-in code',
        body: `Your inqi verification code is ${code}.\n\nIt expires in ${Math.round(mfa.codeTtlMs / 60_000)} minutes. If you didn't request this, you can ignore this email.`,
      });
      this.logger.log(`MFA code emailed to ${normalized} (transport=email)`);
      return { sent: true };
    }
    this.logger.log(`MFA code issued for ${normalized} (mock transport — code is ${mfa.mockCode})`);
    return { sent: true };
  }

  /** Step 2: verify the code, link the account, issue the session. */
  async verifyEmailSignIn({ email, code }: { email: string; code: string }): Promise<SignInResult> {
    const normalized = email.trim().toLowerCase();
    const mfa = this.config.mfa;
    const ok = mfa.transport === 'email'
      ? this.mfaCodes.verify({ email: normalized, code: code.trim(), now: Date.now() })
      : code === mfa.mockCode;
    if (!ok) {
      throw new UnauthorizedError({ code: ErrorCode.AuthInvalidCode, message: 'verification code does not match' });
    }
    // Upsert the identity and claim their prior reports as one unit — a sign-in
    // either fully links the account or changes nothing (both repo calls share the tx).
    // No role is passed: a new account defaults to `customer`; an existing role is kept.
    const { customer, count } = await this.prisma.$transaction(async (tx) => {
      const customer = await this.customers.upsertByEmail({ email: normalized, tx });
      const { count } = await this.reports.linkOwnerByEmail({ email: customer.email, customerId: customer.id, tx });
      return { customer, count };
    });
    if (count) this.logger.log(`linked ${count} prior report(ies) to ${customer.email}`);
    // HP-25: a suspended account verifies its code but is refused a session.
    if (customer.suspendedAt) {
      throw new ForbiddenError({ code: ErrorCode.AccountSuspended, message: 'this account is suspended' });
    }
    // The DB row is authoritative for role (admins are set manually).
    const role = customer.role as AuthRole;
    const token = this.session.sign({ sub: customer.id, email: customer.email, role });
    return { token, customer: { id: customer.id, email: customer.email, name: customer.name, role } };
  }

  /**
   * Prolong an active session: re-issue a fresh full-TTL token for the current
   * principal. The guard already proved the presented token is valid + unexpired,
   * so this is a sliding renewal (call it before the token lapses). Role is re-read
   * from the DB, so a promotion/demotion takes effect on the next refresh.
   */
  async refresh({ user }: { user: AuthUser }): Promise<SignInResult> {
    const customer = await this.customers.findById({ id: user.sub });
    if (!customer) {
      throw new UnauthorizedError({ code: ErrorCode.AuthInvalidToken, message: 'account no longer exists' });
    }
    // HP-25: refuse to prolong a suspended session.
    if (customer.suspendedAt) {
      throw new ForbiddenError({ code: ErrorCode.AccountSuspended, message: 'this account is suspended' });
    }
    const role = customer.role as AuthRole;
    const token = this.session.sign({ sub: customer.id, email: customer.email, role });
    return { token, customer: { id: customer.id, email: customer.email, name: customer.name, role } };
  }

  /** The current principal (from the verified session) — used by GET /auth/me. */
  me({ user }: { user: AuthUser }): AuthUser {
    return user;
  }
}
