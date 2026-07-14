import { Body, Controller, Post, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentService } from '../../domain/agent/agent.service';
import { MessageDto } from '../message-dto/message.dto';
import { InboundEmailDto } from './inbound-email.dto';
import { toInboundEmail } from './inbound-email.mapper';
import { WebhookSignatureGuard } from './webhook-signature.guard';
import { ApiStandardErrors } from '../../common/errors';

/** Webhooks: signature-verified machine ingress (Postmark inbound parse). */
@ApiTags('webhooks')
@UseGuards(WebhookSignatureGuard)
@ApiStandardErrors(400, 401) // every endpoint here can return these (ErrorEnvelope)
@Controller('comms')
export class CommsInboundController {
  constructor(private readonly agent: AgentService) {}

  /** Inbound email (subject provider → inqi): map by To address, thread, run the reply loop. */
  @Post('inbound')
  // External payload carries many extra fields: strip unknown keys instead of rejecting.
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Inbound email webhook (Postmark inbound parse)' })
  @ApiBody({ type: InboundEmailDto })
  @ApiCreatedResponse({ type: MessageDto })
  async inbound(@Body() b: InboundEmailDto) {
    const r = await this.agent.receiveInbound(toInboundEmail(b));
    // HP-27: an intake email created a new report (no thread message to echo back).
    if ('intake' in r) return { reportId: r.reportId, ref: r.ref };
    return r.message;
  }
}
