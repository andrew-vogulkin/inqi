import { Inject, Injectable } from '@nestjs/common';
import { MAIL_PROVIDER, MailKind, MailProvider } from '../source/mail.provider';
import { NotificationChannel, NotificationMessage } from './notification.tokens';

/**
 * Email delivery via the existing {@link MAIL_PROVIDER} (HP-04) — captured by the local
 * driver in dev. Customer-facing (report ready, reminders, denials), so it goes out as
 * {@link MailKind.System}: from the system sender, to the actual customer.
 */
@Injectable()
export class EmailNotificationChannel implements NotificationChannel {
  constructor(@Inject(MAIL_PROVIDER) private readonly mail: MailProvider) {}

  async send({ to, subject, body }: NotificationMessage): Promise<void> {
    await this.mail.send({ kind: MailKind.System, to, subject, body });
  }
}
