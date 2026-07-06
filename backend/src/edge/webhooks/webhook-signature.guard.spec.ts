import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '../../infra/config/config.service';
import { DomainError } from '../../common/errors';
import { WebhookSignatureGuard } from './webhook-signature.guard';

function ctx(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) }),
  } as unknown as ExecutionContext;
}

function guardWith(auth: { user?: string; pass?: string }): WebhookSignatureGuard {
  return new WebhookSignatureGuard({ webhookInboundAuth: auth } as unknown as ConfigService);
}

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

describe('WebhookSignatureGuard', () => {
  it('is open when no credentials are configured', () => {
    expect(guardWith({}).canActivate(ctx())).toBe(true);
  });

  it('accepts matching Basic credentials', () => {
    expect(guardWith({ user: 'pm', pass: 's3cret' }).canActivate(ctx(basic('pm', 's3cret')))).toBe(true);
  });

  it('rejects wrong credentials', () => {
    expect(() => guardWith({ user: 'pm', pass: 's3cret' }).canActivate(ctx(basic('pm', 'nope')))).toThrow(DomainError);
  });

  it('rejects a missing Authorization header', () => {
    expect(() => guardWith({ user: 'pm', pass: 's3cret' }).canActivate(ctx())).toThrow(DomainError);
  });
});
