import { Injectable } from '@nestjs/common';
import { ErrorCode, UnauthorizedError } from '../../common/errors';
import { TokenVerifier, VerifiedIdentity } from './auth.tokens';

/**
 * Dev/e2e identity verifier — bound only when no `GOOGLE_CLIENT_ID` is configured.
 * Token format: `stub:<email>` or `stub:<email>:<name>`. Lets the keyless demo +
 * tests exercise the full sign-in → session → ownership flow without live Google
 * credentials. NEVER selected in production (a real client id swaps in Google).
 */
@Injectable()
export class StubTokenVerifier implements TokenVerifier {
  async verify({ idToken }: { idToken: string }): Promise<VerifiedIdentity> {
    const m = /^stub:([^:@\s]+@[^:@\s]+)(?::(.+))?$/.exec((idToken ?? '').trim());
    if (!m) throw new UnauthorizedError({ code: ErrorCode.AuthInvalidToken, message: 'invalid stub token (expected `stub:<email>`)' });
    const email = m[1].toLowerCase();
    return { sub: `stub-${email}`, email, emailVerified: true, name: m[2] };
  }
}
