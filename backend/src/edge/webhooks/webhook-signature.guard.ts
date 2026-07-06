import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '../../infra/config/config.service';
import { DomainError, ErrorCode } from '../../common/errors';

/**
 * Guards the inbound webhook (machine-to-machine ingress). Postmark secures
 * inbound parse via HTTP Basic Auth embedded in the webhook URL, so we verify the
 * Authorization header against configured credentials. When none are configured
 * the webhook is open (dev). On mismatch we reject with WEBHOOK_SIGNATURE_INVALID.
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const { user, pass } = this.config.webhookInboundAuth;
    if (!user && !pass) return true; // open in dev / when unconfigured

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');
    const ok =
      scheme === 'Basic' &&
      !!encoded &&
      Buffer.from(encoded, 'base64').toString('utf8') === `${user ?? ''}:${pass ?? ''}`;

    if (!ok) {
      throw new DomainError({
        code: ErrorCode.WebhookSignatureInvalid,
        message: 'invalid or missing webhook credentials',
        httpStatus: HttpStatus.UNAUTHORIZED,
        retryable: false,
      });
    }
    return true;
  }
}
