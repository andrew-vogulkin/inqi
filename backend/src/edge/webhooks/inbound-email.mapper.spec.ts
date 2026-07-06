import { toInboundEmail } from './inbound-email.mapper';

describe('toInboundEmail', () => {
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
});
