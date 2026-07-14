import { InboundEmailDto } from './inbound-email.dto';

/** Normalized inbound email the agent ingests (independent of the wire format). */
export interface InboundEmail {
  toAddr: string;
  /**
   * EVERY address this email was addressed to — the delivered address AND the original
   * `To:` header. A mailbox that FORWARDS into the webhook (Google Workspace →
   * Postmark inbound) rewrites the delivered address to the forwarder's own, so the
   * address the human actually typed (e.g. the intake mailbox) survives only in `To:`.
   * Capability/reply routing still uses {@link toAddr}; intake matches any of these.
   */
  recipients?: string[];
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

/** Bare addresses from an RFC 5322 address list: `"inqi" <a@x>, b@y` → ['a@x', 'b@y']. */
function addresses(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => (part.match(/<([^>]+)>/)?.[1] ?? part).trim().toLowerCase())
    .filter((a) => a.includes('@'));
}

/**
 * Map an inbound webhook payload (Postmark capitalized fields or internal
 * lowercase keys) to the normalized {@link InboundEmail}. Pure + unit-tested so
 * the controller stays thin.
 */
export function toInboundEmail(dto: InboundEmailDto): InboundEmail {
  const references = dto.references ?? header({ dto, name: 'References' })?.split(/\s+/).filter(Boolean);
  // OriginalRecipient is Postmark's bare delivered address — best for thread mapping.
  const toAddr = dto.to ?? dto.toAddr ?? dto.OriginalRecipient ?? dto.To ?? '';
  // A forwarding mailbox rewrites the delivered address, so keep the To header too
  // (+ Delivered-To, which forwarders commonly stamp with the original mailbox).
  const recipients = Array.from(new Set([
    ...addresses(toAddr),
    ...addresses(dto.OriginalRecipient),
    ...addresses(dto.To),
    ...addresses(header({ dto, name: 'Delivered-To' })),
    ...addresses(header({ dto, name: 'X-Original-To' })),
  ]));
  return {
    toAddr,
    recipients,
    fromAddr: dto.from ?? dto.fromAddr ?? dto.From,
    subject: dto.subject ?? dto.Subject,
    body: dto.text ?? dto.body ?? dto.TextBody ?? dto.HtmlBody ?? '',
    // Prefer the original Message-ID header (provider's id) for threading/idempotency.
    externalId: dto.messageId ?? dto.externalId ?? header({ dto, name: 'Message-ID' }) ?? dto.MessageID,
    inReplyTo: dto.inReplyTo ?? header({ dto, name: 'In-Reply-To' }),
    references,
  };
}
