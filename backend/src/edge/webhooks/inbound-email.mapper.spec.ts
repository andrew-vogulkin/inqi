import { toInboundEmail } from './inbound-email.mapper';
import type { InboundEmailDto } from './inbound-email.dto';

describe('toInboundEmail', () => {
  // A REAL Postmark inbound payload carries ~20 fields we don't model (FromFull, ToFull, Cc,
  // MessageStream, Attachments, Date, MailboxHash, …). The webhook accepts the raw object, so
  // the mapper must read only what it needs and ignore the rest — never throw on extras.
  it('maps a FULL Postmark payload, ignoring the many unmodeled fields', () => {
    const full = {
      FromName: 'Andrei V', From: 'andrei@monkeycode.io',
      FromFull: { Email: 'andrei@monkeycode.io', Name: 'Andrei V', MailboxHash: '' },
      To: 'intake@inqi-postmark-reply.monkeycode.io',
      ToFull: [{ Email: 'intake@inqi-postmark-reply.monkeycode.io', Name: '', MailboxHash: '' }],
      OriginalRecipient: 'intake@inqi-postmark-reply.monkeycode.io',
      Cc: '', CcFull: [], Bcc: '', BccFull: [], ReplyTo: '', MailboxHash: '',
      Subject: 'Wedding photographer in Lisbon', MessageID: 'a1b2c3',
      MessageStream: 'inbound', Date: 'Wed, 16 Jul 2026 04:01:00 +0000',
      TextBody: 'Need a photographer, June 2026, up to 2000 EUR.',
      HtmlBody: '<p>...</p>', StrippedTextReply: '', Tag: '', Attachments: [],
    } as unknown as InboundEmailDto;
    const r = toInboundEmail(full);
    expect(r.fromAddr).toBe('andrei@monkeycode.io');
    expect(r.toAddr).toBe('intake@inqi-postmark-reply.monkeycode.io');
    expect(r.subject).toBe('Wedding photographer in Lisbon');
    expect(r.body).toBe('Need a photographer, June 2026, up to 2000 EUR.');
    expect(r.recipients).toContain('intake@inqi-postmark-reply.monkeycode.io');
  });

  it('maps a Postmark inbound payload (capitalized fields + headers)', () => {
    const r = toInboundEmail({
      From: 'sales@provider.example',
      To: 'Inqi <abc123@reply.inqi.example>',
      OriginalRecipient: 'abc123@reply.inqi.example',
      Subject: 'Re: report',
      TextBody: 'Yes, in stock. 290 EUR.',
      MessageID: 'pm-internal-id',
      Headers: [
        { Name: 'Message-ID', Value: '<real-msg@provider.example>' },
        { Name: 'In-Reply-To', Value: '<msg-0@inqi>' },
        { Name: 'References', Value: '<a@x> <b@y>' },
      ],
    });
    // OriginalRecipient (bare address) is preferred for thread mapping over the display-name To.
    expect(r.toAddr).toBe('abc123@reply.inqi.example');
    expect(r.fromAddr).toBe('sales@provider.example');
    expect(r.subject).toBe('Re: report');
    expect(r.body).toBe('Yes, in stock. 290 EUR.');
    // The original Message-ID header is preferred over Postmark's internal MessageID.
    expect(r.externalId).toBe('<real-msg@provider.example>');
    expect(r.inReplyTo).toBe('<msg-0@inqi>');
    expect(r.references).toEqual(['<a@x>', '<b@y>']);
  });

  it('maps an internal lowercase payload', () => {
    const r = toInboundEmail({
      to: 'abc@reply.inqi.example',
      from: 'p@x.com',
      subject: 'Re',
      text: 'hi',
      messageId: '<m@x>',
      inReplyTo: '<m0@inqi>',
      references: ['<m0@inqi>'],
    });
    expect(r).toEqual({
      toAddr: 'abc@reply.inqi.example',
      recipients: ['abc@reply.inqi.example'],
      fromAddr: 'p@x.com',
      subject: 'Re',
      body: 'hi',
      externalId: '<m@x>',
      inReplyTo: '<m0@inqi>',
      references: ['<m0@inqi>'],
    });
  });

  it('falls back to MessageID and HtmlBody when needed', () => {
    const r = toInboundEmail({ OriginalRecipient: 'a@b', From: 'c@d', MessageID: 'pm-1', HtmlBody: '<p>hi</p>' });
    expect(r.externalId).toBe('pm-1');
    expect(r.body).toBe('<p>hi</p>');
  });

  // A forwarding mailbox (Google Workspace → Postmark inbound) delivers to Postmark's
  // hash address; the address the sender actually typed survives only in To/Delivered-To.
  it('collects every recipient address, so a FORWARDED email still exposes the original To', () => {
    const r = toInboundEmail({
      OriginalRecipient: 'a1b2c3@inbound.postmarkapp.com',
      To: '"inqi intake" <intake_inqi@monkeycode.io>',
      From: 'ada@x.io',
      TextBody: 'find me a car',
      Headers: [{ Name: 'Delivered-To', Value: 'intake_inqi@monkeycode.io' }],
    });
    // Thread routing still uses the delivered address …
    expect(r.toAddr).toBe('a1b2c3@inbound.postmarkapp.com');
    // … but the intake mailbox is recoverable, with the display name stripped.
    expect(r.recipients).toContain('intake_inqi@monkeycode.io');
    expect(r.recipients).toContain('a1b2c3@inbound.postmarkapp.com');
  });

  // Postmark hands us bare addresses; a Gmail/Workspace bridge hands us `"Name" <a@b>`.
  // The owner check compares fromAddr to a bare address and capability routing splits
  // toAddr on '@' — a display name would break both, so strip it at the boundary.
  it('strips display names from From and To (Gmail-shaped payload)', () => {
    const r = toInboundEmail({
      To: '"inqi" <7f3a@inqi-postmark-reply.monkeycode.io>',
      From: '"Ada Lovelace" <Ada@X.io>',
      Subject: 'Re: A few quick questions',
      TextBody: 'under 3000 THB, evenings',
    });
    expect(r.toAddr).toBe('7f3a@inqi-postmark-reply.monkeycode.io'); // capability address, routable
    expect(r.fromAddr).toBe('ada@x.io');                             // bare + normalized → owner check matches
  });
});
