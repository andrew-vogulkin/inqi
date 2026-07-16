import { Body, Controller, Post, UseGuards } from '@nestjs/common';
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
  @ApiOperation({ summary: 'Inbound email webhook (Postmark inbound parse)' })
  @ApiBody({ type: InboundEmailDto })
  @ApiCreatedResponse({ type: MessageDto })
  // Postmark's real inbound payload carries ~20 fields (FromFull, ToFull, Cc, Attachments,
  // MessageStream, Date, …). This is auth-guarded machine ingress on a provider-owned,
  // evolving shape — so we accept the raw object rather than whitelist-validate it. Typing
  // the body as a plain object makes BOTH the global ValidationPipe (forbidNonWhitelisted:
  // true) and any route pipe skip it — a strict DTO here would 400 every real inbound email.
  async inbound(@Body() b: Record<string, unknown>) {
    const r = await this.agent.receiveInbound(toInboundEmail(b as unknown as InboundEmailDto));
    // HP-27: an intake email created a new report (no thread message to echo back), or was
    // refused by the credit gate — 200 either way, so the provider never retries a refusal.
    if ('intake' in r) return { reportId: r.reportId, ref: r.ref, ...(r.refused ? { refused: true } : {}) };
    return r.message;
  }
}
