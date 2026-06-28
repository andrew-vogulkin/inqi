import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../infra/config/config.service';
import { ErrorCode, UnauthorizedError } from '../../common/errors';
import { TokenVerifier, VerifiedIdentity } from './auth.tokens';

/** Google's `tokeninfo` response (subset we use). */
interface TokenInfo { aud?: string; sub?: string; email?: string; email_verified?: string | boolean; name?: string; }

/**
 * Verifies a Google ID token server-side via Google's `tokeninfo` endpoint
 * (validates signature + expiry) and checks the audience against our client id.
 * Dependency-free; the local-JWKS verify (google-auth-library) is the upgrade seam
 * for higher throughput. Bound to {@link TOKEN_VERIFIER} when GOOGLE_CLIENT_ID is set.
 */
@Injectable()
export class GoogleTokenVerifier implements TokenVerifier {
  private readonly logger = new Logger(GoogleTokenVerifier.name);
  constructor(private readonly config: ConfigService) {}

  async verify({ idToken }: { idToken: string }): Promise<VerifiedIdentity> {
    const clientId = this.config.google.clientId;
    let info: TokenInfo;
    try {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!res.ok) throw new Error(`tokeninfo ${res.status}`); // expired/invalid tokens return 4xx
      info = (await res.json()) as TokenInfo;
    } catch (e) {
      throw new UnauthorizedError({ code: ErrorCode.AuthInvalidToken, message: `Google token verification failed: ${(e as Error).message}` });
    }
    if (clientId && info.aud !== clientId) {
      throw new UnauthorizedError({ code: ErrorCode.AuthInvalidToken, message: 'Google token audience mismatch' });
    }
    if (!info.email || !info.sub) {
      throw new UnauthorizedError({ code: ErrorCode.AuthInvalidToken, message: 'Google token missing subject/email' });
    }
    return {
      sub: String(info.sub),
      email: String(info.email).toLowerCase(),
      emailVerified: info.email_verified === true || info.email_verified === 'true',
      name: info.name,
    };
  }
}
