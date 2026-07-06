import { InboundEmailDto } from './inbound-email.dto';

/** Normalized inbound email the agent ingests (independent of the wire format). */
export interface InboundEmail {
  toAddr: string;
  fromAddr?: string;
  subject?: string;
  body: string;
  externalId?: string;
  inReplyTo?: string;
  references?: string[];
}

/** Look up an RFC 5322 header by name (case-insensitive) from a Postmark payload. */
function header({ dto, name }: { dto: InboundEmailDto; name: string }): string | undefined {
  return dto.Headers?.find((h) => h.Name?.toLowerCase() === name.toLowerCase())?.Value;
}

/**
 * Map an inbound webhook payload (Postmark capitalized fields or internal
 * lowercase keys) to the normalized {@link InboundEmail}. Pure + unit-tested so
 * the controller stays thin.
 */
export function toInboundEmail(dto: InboundEmailDto): InboundEmail {
  const references = dto.references ?? header({ dto, name: 'References' })?.split(/\s+/).filter(Boolean);
  return {
    // OriginalRecipient is Postmark's bare delivered address — best for thread mapping.
    toAddr: dto.to ?? dto.toAddr ?? dto.OriginalRecipient ?? dto.To ?? '',
    fromAddr: dto.from ?? dto.fromAddr ?? dto.From,
    subject: dto.subject ?? dto.Subject,
    body: dto.text ?? dto.body ?? dto.TextBody ?? dto.HtmlBody ?? '',
    // Prefer the original Message-ID header (provider's id) for threading/idempotency.
    externalId: dto.messageId ?? dto.externalId ?? header({ dto, name: 'Message-ID' }) ?? dto.MessageID,
    inReplyTo: dto.inReplyTo ?? header({ dto, name: 'In-Reply-To' }),
    references,
  };
}
