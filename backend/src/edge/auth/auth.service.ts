import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthRole } from '@inqi/shared';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { ErrorCode, UnauthorizedError } from '../../common/errors';
import { CustomerService } from '../../domain/customer/customer.service';
import { InquiryService } from '../../domain/inquiry/inquiry.service';
import { TOKEN_VERIFIER, TokenVerifier, AuthUser } from './auth.tokens';
import { SessionService } from './session.service';

export interface SignInResult {
  token: string;
  customer: { id: string; email: string; name?: string | null; role: AuthRole };
}

/**
 * Sign in with Google (HP-10): verify the ID token, upsert the Customer by verified
 * email (new accounts default to the `customer` role), claim any inquiries submitted
 * with that email, and issue a signed session.
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
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    private readonly prisma: PrismaService,
    private readonly customers: CustomerService,
    private readonly inquiries: InquiryService,
    private readonly session: SessionService,
  ) {}

  async signInWithGoogle({ idToken }: { idToken: string }): Promise<SignInResult> {
    const identity = await this.verifier.verify({ idToken });
    if (!identity.emailVerified) {
      throw new UnauthorizedError({ code: ErrorCode.AuthInvalidToken, message: 'email not verified by the identity provider' });
    }
    // Upsert the identity and claim their prior inquiries as one unit — a sign-in
    // either fully links the account or changes nothing (both repo calls share the tx).
    // No role is passed: a new account defaults to `customer`; an existing role is kept.
    const { customer, count } = await this.prisma.$transaction(async (tx) => {
      const customer = await this.customers.upsertByEmail({ email: identity.email, googleSub: identity.sub, name: identity.name, tx });
      const { count } = await this.inquiries.linkOwnerByEmail({ email: customer.email, customerId: customer.id, tx });
      return { customer, count };
    });
    if (count) this.logger.log(`linked ${count} prior inquiry(ies) to ${customer.email}`);
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
