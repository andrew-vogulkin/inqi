import { Module } from '@nestjs/common';
import { MailDriver } from '@inqi/shared';
import { ConfigService } from '../../infra/config/config.service';
import { MAIL_PROVIDER, PostmarkMailProvider } from '../outreach/mail.provider';
import { LocalMailProvider } from '../outreach/local-mail.provider';
import { NotificationService } from './notification.service';
import { NotificationRepository } from './notification.repository';
import { EmailNotificationChannel } from './email-notification.channel';
import { NOTIFICATION_CHANNEL } from './notification.tokens';

/**
 * Domain: customer notifications (HP-13). Reuses the MailProvider transport behind
 * a NotificationChannel seam; registers the SendNotification worker + reminder
 * sweep on init.
 */
@Module({
  providers: [
    NotificationService,
    NotificationRepository,
    EmailNotificationChannel,
    { provide: MAIL_PROVIDER, useFactory: (config: ConfigService) => (config.mailDriver === MailDriver.Postmark ? new PostmarkMailProvider(config) : new LocalMailProvider(config)), inject: [ConfigService] },
    { provide: NOTIFICATION_CHANNEL, useExisting: EmailNotificationChannel },
  ],
})
export class NotificationModule {}
