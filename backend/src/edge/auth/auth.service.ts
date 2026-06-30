import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthRole } from '@inqi/shared';
import { ConfigService } from '../../infra/config/config.service';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { ErrorCode, UnauthorizedError } from '../../common/errors';
import { CustomerService } from '../../domain/customer/customer.service';
import { InquiryService } from '../../domain/inquiry/inquiry.service';
import { TOKEN_VERIFIER, TokenVerifier, AuthUser } from './auth.tokens';
import { SessionService } from './session.service';
import { resolveRole } from './role';

export interface SignInResult {
  token: string;
  customer: { id: string; email: string; name?: string | null; role: AuthRole };
}

/**
 * Sign in with Google (HP-10): verify the ID token, upsert the Customer by verified
 * email, grant admin by the config allowlist, claim any inquiries submitted with
 * that email, and issue a signed session.
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
    private readonly config: ConfigService,
  ) {}

  async signInWithGoogle({ idToken }: { idToken: string }): Promise<SignInResult> {
    const identity = await this.verifier.verify({ idToken });
    if (!identity.emailVerified) {
      throw new UnauthorizedError({ code: ErrorCode.AuthInvalidToken, message: 'email not verified by the identity provider' });
    }
    const { emails, domain } = this.config.adminAllowlist;
    const role = resolveRole({ email: identity.email, adminEmails: emails, adminDomain: domain });
    // Upsert the identity and claim their prior inquiries as one unit — a sign-in
    // either fully links the account or changes nothing (both repo calls share the tx).
    const { customer, count } = await this.prisma.$transaction(async (tx) => {
      const customer = await this.customers.upsertByEmail({ email: identity.email, googleSub: identity.sub, name: identity.name, role, tx });
      const { count } = await this.inquiries.linkOwnerByEmail({ email: customer.email, customerId: customer.id, tx });
      return { customer, count };
    });
    if (count) this.logger.log(`linked ${count} prior inquiry(ies) to ${customer.email}`);
    const token = this.session.sign({ sub: customer.id, email: customer.email, role });
    return { token, customer: { id: customer.id, email: customer.email, name: customer.name, role } };
  }

  /** The current principal (from the verified session) — used by GET /auth/me. */
  me({ user }: { user: AuthUser }): AuthUser {
    return user;
  }
}
