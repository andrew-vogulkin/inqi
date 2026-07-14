import { ConfigService } from '../../infra/config/config.service';
import { MailKind, OUTBOUND_TO_OVERRIDE, PostmarkMailProvider } from './mail.provider';

/** ConfigService stub exposing just the `.postmark` the provider reads — one signature per kind. */
const config = {
  postmark: { token: 'pm-test', systemFrom: 'system@monkeycode.io', outreachFrom: 'marlowe.v@monkeycode.io' },
} as unknown as ConfigService;

/** Capture the JSON body posted to the Postmark API. */
function stubFetchOk() {
  const body = { current: null as any };
  global.fetch = jest.fn(async (_url: string, init: { body: string }) => {
    body.current = JSON.parse(init.body);
    return { ok: true, json: async () => ({ MessageID: 'abc-123', ErrorCode: 0 }) } as any;
  }) as unknown as typeof fetch;
  return body;
}

describe('PostmarkMailProvider — sender identity per MailKind', () => {
  const provider = new PostmarkMailProvider(config);
  afterEach(() => jest.restoreAllMocks());

  it('sends vendor outreach from the outreach persona', async () => {
    const captured = stubFetchOk();
    await provider.send({ kind: MailKind.Outreach, to: 'sales@vendor.co.th', subject: 'Availability?', body: 'Hi' });
    expect(captured.current.From).toBe('marlowe.v@monkeycode.io');
  });

  it('sends system mail (sign-in codes, customer notifications) from the system sender', async () => {
    const captured = stubFetchOk();
    await provider.send({ kind: MailKind.System, to: 'jane@gmail.com', subject: 'Your inqi sign-in code', body: '123456' });
    expect(captured.current.From).toBe('system@monkeycode.io');
  });
});

describe('PostmarkMailProvider — beta recipient pin (outreach only)', () => {
  const provider = new PostmarkMailProvider(config);
  const outreach = { kind: MailKind.Outreach as const, replyTo: 'tok9@reply.monkeycode.io', subject: 'Availability?', body: 'Hi there' };

  afterEach(() => jest.restoreAllMocks());

  it('is pinned to the same-domain inbox', () => {
    expect(OUTBOUND_TO_OVERRIDE).toBe('andrei@monkeycode.io');
  });

  it('redirects an off-domain vendor recipient, preserving the intended To', async () => {
    const captured = stubFetchOk();
    await provider.send({ ...outreach, to: 'sales@some-vendor.co.th' });

    expect(captured.current.To).toBe('andrei@monkeycode.io');
    expect(captured.current.Subject).toBe('[→ sales@some-vendor.co.th] Availability?');
    expect(captured.current.Headers).toContainEqual({ Name: 'X-Original-To', Value: 'sales@some-vendor.co.th' });
    // ReplyTo stays the per-thread inbound address so replies still thread.
    expect(captured.current.ReplyTo).toBe('tok9@reply.monkeycode.io');
  });

  it('redirects even a null recipient (would otherwise fail the Postmark send)', async () => {
    const captured = stubFetchOk();
    await provider.send({ ...outreach, to: null });
    expect(captured.current.To).toBe('andrei@monkeycode.io');
  });

  it('does not tag the subject when the recipient is already the pinned inbox', async () => {
    const captured = stubFetchOk();
    await provider.send({ ...outreach, to: 'andrei@monkeycode.io' });
    expect(captured.current.To).toBe('andrei@monkeycode.io');
    expect(captured.current.Subject).toBe('Availability?');
    expect(captured.current.Headers ?? []).not.toContainEqual(expect.objectContaining({ Name: 'X-Original-To' }));
  });

  // The whole point of the split: a sign-in code redirected to someone else is unusable,
  // and a delivered report must reach the customer who asked for it.
  it('does NOT redirect system mail — it reaches the real recipient, untagged', async () => {
    const captured = stubFetchOk();
    await provider.send({ kind: MailKind.System, to: 'jane@gmail.com', subject: 'Your inqi sign-in code', body: '123456' });

    expect(captured.current.To).toBe('jane@gmail.com');
    expect(captured.current.Subject).toBe('Your inqi sign-in code');
    expect(captured.current.Headers ?? []).not.toContainEqual(expect.objectContaining({ Name: 'X-Original-To' }));
  });

  it('keeps ReplyTo on system mail (questionnaire-by-email replies must route back)', async () => {
    const captured = stubFetchOk();
    await provider.send({ kind: MailKind.System, to: 'jane@gmail.com', replyTo: 'q7@reply.monkeycode.io', subject: 'A few quick questions', body: '?' });
    expect(captured.current.To).toBe('jane@gmail.com');
    expect(captured.current.ReplyTo).toBe('q7@reply.monkeycode.io');
  });

  it('omits ReplyTo entirely when there is no reply address (plain notification)', async () => {
    const captured = stubFetchOk();
    await provider.send({ kind: MailKind.System, to: 'jane@gmail.com', subject: 'Your report is ready', body: 'Done' });
    expect('ReplyTo' in captured.current).toBe(false);
  });
});
