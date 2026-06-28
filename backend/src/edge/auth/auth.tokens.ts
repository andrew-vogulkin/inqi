import { AuthRole } from '@inqi/shared';

/** A verified identity from an OIDC ID token (Google) or the dev/e2e stub. */
export interface VerifiedIdentity {
  sub: string;            // stable subject id from the IdP
  email: string;          // lowercased
  emailVerified: boolean;
  name?: string;
}

/**
 * Swappable identity verifier (Sign in with Google now; enterprise OIDC/SSO is the
 * open seam). Bind a concrete impl to {@link TOKEN_VERIFIER}, inject by token.
 */
export interface TokenVerifier {
  verify(args: { idToken: string }): Promise<VerifiedIdentity>;
}
export const TOKEN_VERIFIER = Symbol('TokenVerifier');

/** The authenticated principal the guards attach to the request. */
export interface AuthUser {
  sub: string;     // Customer.id
  email: string;
  role: AuthRole;
}
