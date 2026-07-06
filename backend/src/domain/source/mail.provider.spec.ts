import { ConfigService } from '../../infra/config/config.service';
import { OUTBOUND_TO_OVERRIDE, PostmarkMailProvider } from './mail.provider';

/** ConfigService stub exposing just the `.postmark` the provider reads. */
const config = { postmark: { token: 'pm-test', fromAddress: 'marlowe.v@monkeycode.io' } } as unknown as ConfigService;

/** Capture the JSON body posted to the Postmark API. */
function stubFetchOk() {
  const body = { current: null as any };
  global.fetch = jest.fn(async (_url: string, init: { body: string }) => {
    body.current = JSON.parse(init.body);
    return { ok: true, json: async () => ({ MessageID: 'abc-123', ErrorCode: 0 }) } as any;
  }) as unknown as typeof fetch;
  return body;
}

describe('PostmarkMailProvider — approval-window recipient pin', () => {
  const provider = new PostmarkMailProvider(config);
  const base = { from: 'tok9@reply.monkeycode.io', subject: 'Availability?', body: 'Hi there' };

  afterEach(() => jest.restoreAllMocks());

  it('is pinned to the same-domain inbox while unapproved', () => {
    expect(OUTBOUND_TO_OVERRIDE).toBe('andrei@monkeycode.io');
  });

  it('redirects an off-domain vendor recipient, preserving the intended To', async () => {
    const captured = stubFetchOk();
    await provider.send({ ...base, to: 'sales@some-vendor.co.th' });

    expect(captured.current.To).toBe('andrei@monkeycode.io');
    expect(captured.current.Subject).toBe('[→ sales@some-vendor.co.th] Availability?');
    expect(captured.current.Headers).toContainEqual({ Name: 'X-Original-To', Value: 'sales@some-vendor.co.th' });
    // ReplyTo stays the per-thread inbound address so replies still thread.
    expect(captured.current.ReplyTo).toBe('tok9@reply.monkeycode.io');
  });

  it('redirects even a null recipient (would otherwise fail the Postmark send)', async () => {
    const captured = stubFetchOk();
    await provider.send({ ...base, to: null });
    expect(captured.current.To).toBe('andrei@monkeycode.io');
  });

  it('does not tag the subject when the recipient is already the pinned inbox', async () => {
    const captured = stubFetchOk();
    await provider.send({ ...base, to: 'andrei@monkeycode.io' });
    expect(captured.current.To).toBe('andrei@monkeycode.io');
    expect(captured.current.Subject).toBe('Availability?');
    expect(captured.current.Headers ?? []).not.toContainEqual(expect.objectContaining({ Name: 'X-Original-To' }));
  });
});
