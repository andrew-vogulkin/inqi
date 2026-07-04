import { Injectable, Logger } from '@nestjs/common';
import { AuthRole } from '@inqi/shared';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { ConfigService } from '../../infra/config/config.service';
import { ErrorCode, UnauthorizedError } from '../../common/errors';
import { CustomerService } from '../../domain/customer/customer.service';
import { ReportService } from '../../domain/report/report.service';
import { AuthUser } from './auth.tokens';
import { SessionService } from './session.service';

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
  ) {}

  /** Step 1: issue the verification code (mock transport — nothing is actually emailed yet). */
  startEmailSignIn({ email }: { email: string }): { sent: boolean } {
    const normalized = email.trim().toLowerCase();
    // Mock MFA: the code is fixed via config; a real transport would email a one-time code here.
    this.logger.log(`MFA code issued for ${normalized} (mock transport — code is ${this.config.mfa.mockCode})`);
    return { sent: true };
  }

  /** Step 2: verify the code, link the account, issue the session. */
  async verifyEmailSignIn({ email, code }: { email: string; code: string }): Promise<SignInResult> {
    const normalized = email.trim().toLowerCase();
    if (code !== this.config.mfa.mockCode) {
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
    // The DB row is authoritative for role (admins are set manually).
    const role = customer.role as AuthRole;
    const token = this.session.sign({ sub: customer.id, email: customer.email, role });
    return { token, customer: { id: customer.id, email: customer.email, name: customer.name, role } };
  }

  /** The current principal (from the verified session) — used by GET /auth/me. */
  me({ user }: { user: AuthUser }): AuthUser {
    return user;
  }
}
