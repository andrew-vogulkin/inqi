import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '../../infra/config/config.service';
import { MAIL_PROVIDER, MailProvider } from '../outreach/mail.provider';
import { NotificationChannel, NotificationMessage } from './notification.tokens';

/** Email delivery via the existing {@link MAIL_PROVIDER} (HP-04) — captured by the local driver in dev. */
@Injectable()
export class EmailNotificationChannel implements NotificationChannel {
  constructor(
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly config: ConfigService,
  ) {}

  async send({ to, subject, body }: NotificationMessage): Promise<void> {
    const from = this.config.postmark.fromAddress ?? `inqi <notifications@${this.config.inboundDomain}>`;
    await this.mail.send({ from, to, subject, body });
  }
}
