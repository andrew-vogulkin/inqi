import { Module } from '@nestjs/common';
import { MailDriver } from '@inqi/shared';
import { ConfigService } from '../../infra/config/config.service';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { ComplianceModule } from '../compliance/compliance.module';
import { SourcesService } from './sources.service';
import { SourcesRepository } from './sources.repository';
import { EmailChannelService } from './email.service';
import { EmailChannelRepository } from './email.repository';
import { MAIL_PROVIDER, PostmarkMailProvider } from './mail.provider';
import { LocalMailProvider } from './local-mail.provider';

/**
 * Domain: the Source layer — every channel touchpoint of an Inquiry (websearch,
 * rating_feedback, and the email thread channel), with MailProvider via DI.
 */
@Module({
  imports: [ComplianceModule],
  providers: [
    SourcesService,
    SourcesRepository,
    EmailChannelService,
    EmailChannelRepository,
    // Bind MAIL_PROVIDER to Postmark or the local capture provider per config.
    {
      provide: MAIL_PROVIDER,
      useFactory: (config: ConfigService, ai: AiProvider) =>
        config.mailDriver === MailDriver.Postmark ? new PostmarkMailProvider(config) : new LocalMailProvider(config, ai),
      inject: [ConfigService, AI_PROVIDER],
    },
  ],
  exports: [SourcesService, EmailChannelService, MAIL_PROVIDER],
})
export class SourcesModule {}
