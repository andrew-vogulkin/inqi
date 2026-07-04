import { tmpdir } from 'os';
import { join } from 'path';
import { LocalMailProvider } from './local-mail.provider';

/**
 * Loopback reply behavior: follow-ups get answered (bounded), and a configurable
 * fraction of providers never reply at all — silence is sticky, so the
 * reply-timeout reaper path gets exercised end-to-end in dev.
 */
function makeProvider({ ignoreRate }: { ignoreRate: number }) {
  const config = {
    simulateReplies: true,
    simulateReplyIgnoreRate: ignoreRate,
    localMailDir: join(tmpdir(), 'inqi-localmail-spec'),
    publicBaseUrl: 'http://localhost:0',
    webhookInboundAuth: {},
  };
  const ai = { complete: jest.fn(async () => 'we can help, 100 USD') };
  return { provider: new LocalMailProvider(config as never, ai as never), config };
}

const mail = (from: string) => ({ from, to: 'provider@example.com', subject: 'Inquiry', body: 'price?' });

describe('LocalMailProvider — simulated replies, follow-ups and ignoring providers', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('rate 0: replies to the first email AND to follow-ups, capped at 3 per thread', async () => {
    const { provider } = makeProvider({ ignoreRate: 0 });
    await provider.send(mail('t1@reply.example'));
    expect(jest.getTimerCount()).toBe(1); // first reply scheduled
    await provider.send(mail('t1@reply.example'));
    await provider.send(mail('t1@reply.example'));
    expect(jest.getTimerCount()).toBe(3); // follow-ups answered too
    await provider.send(mail('t1@reply.example'));
    expect(jest.getTimerCount()).toBe(3); // bounded — a 4th send gets silence
  });

  it('rate 1: the provider never replies, and silence is sticky across follow-ups', async () => {
    const { provider } = makeProvider({ ignoreRate: 1 });
    await provider.send(mail('t2@reply.example'));
    await provider.send(mail('t2@reply.example'));
    expect(jest.getTimerCount()).toBe(0);
    expect(provider.sent).toHaveLength(2); // the emails still go out — the provider just ignores them
  });

  it('a provider who engaged keeps replying even if the ignore roll would now say otherwise', async () => {
    const { provider, config } = makeProvider({ ignoreRate: 0 });
    await provider.send(mail('t3@reply.example'));
    expect(jest.getTimerCount()).toBe(1);
    (config as { simulateReplyIgnoreRate: number }).simulateReplyIgnoreRate = 1; // roll only happens on first contact
    await provider.send(mail('t3@reply.example'));
    expect(jest.getTimerCount()).toBe(2);
  });
});
