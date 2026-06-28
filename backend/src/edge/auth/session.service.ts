import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { AuthRole } from '@inqi/shared';
import { ConfigService } from '../../infra/config/config.service';
import { ErrorCode, UnauthorizedError } from '../../common/errors';

/** Claims carried in a session token. */
export interface SessionClaims {
  sub: string;   // Customer.id
  email: string;
  role: AuthRole;
}
interface TokenPayload extends SessionClaims {
  iat: number;
  exp: number;
}

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/**
 * Stateless session tokens — a compact HS256 JWT signed with `SESSION_SECRET`
 * (Node `crypto`, no extra deps). Claims are signed, never PII-in-URL; expiry is
 * enforced on verify. Issued on Sign in with Google, checked by the guards.
 */
@Injectable()
export class SessionService {
  constructor(private readonly config: ConfigService) {}

  sign(claims: SessionClaims): string {
    const { secret, ttlHours } = this.config.session;
    const now = Math.floor(Date.now() / 1000);
    const payload: TokenPayload = { ...claims, iat: now, exp: now + Math.round(ttlHours * 3600) };
    const head = enc({ alg: 'HS256', typ: 'JWT' });
    const body = enc(payload);
    return `${head}.${body}.${this.sig(`${head}.${body}`, secret)}`;
  }

  /** Verify signature + expiry; returns the claims or throws a typed 401. */
  verify(token: string): SessionClaims {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedError({ code: ErrorCode.AuthInvalidToken, message: 'malformed session token' });
    const [head, body, sig] = parts;
    const expected = this.sig(`${head}.${body}`, this.config.session.secret);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedError({ code: ErrorCode.AuthInvalidToken, message: 'invalid session signature' });
    }
    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
      throw new UnauthorizedError({ code: ErrorCode.AuthInvalidToken, message: 'invalid session payload' });
    }
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
      throw new UnauthorizedError({ code: ErrorCode.AuthTokenExpired, message: 'session expired' });
    }
    return { sub: payload.sub, email: payload.email, role: payload.role };
  }

  private sig(data: string, secret: string): string {
    return createHmac('sha256', secret).update(data).digest('base64url');
  }
}
