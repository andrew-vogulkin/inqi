import { Module } from '@nestjs/common';
import { AgentModule } from '../../domain/agent/agent.module';
import { CommsInboundController } from './comms.controller';
import { WebhookSignatureGuard } from './webhook-signature.guard';

/** Edge: signature-verified machine ingress (webhooks). */
@Module({
  imports: [AgentModule],
  controllers: [CommsInboundController],
  providers: [WebhookSignatureGuard],
})
export class WebhooksModule {}
