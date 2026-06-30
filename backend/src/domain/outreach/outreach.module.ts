import { Module } from '@nestjs/common';
import { MailDriver } from '@inqi/shared';
import { ConfigService } from '../../infra/config/config.service';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { ComplianceModule } from '../compliance/compliance.module';
import { OutreachService } from './outreach.service';
import { OutreachRepository } from './outreach.repository';
import { MAIL_PROVIDER, PostmarkMailProvider } from './mail.provider';
import { LocalMailProvider } from './local-mail.provider';

/** Domain: the outreach communication track (messages/email), with MailProvider via DI. */
@Module({
  imports: [ComplianceModule],
  providers: [
    OutreachService,
    OutreachRepository,
    // Bind MAIL_PROVIDER to Postmark or the local capture provider per config.
    {
      provide: MAIL_PROVIDER,
      useFactory: (config: ConfigService, ai: AiProvider) =>
        config.mailDriver === MailDriver.Postmark ? new PostmarkMailProvider(config) : new LocalMailProvider(config, ai),
      inject: [ConfigService, AI_PROVIDER],
    },
  ],
  exports: [OutreachService],
})
export class OutreachModule {}
