import { SimulatedRepliesMailProvider } from './simulated-replies.provider';
import { MailKind, SendMailArgs } from './mail.provider';

/**
 * Loopback reply behavior (decorator over ANY transport): follow-ups get answered
 * (bounded), and a configurable fraction of providers never reply at all — silence
 * is sticky, so the reply-timeout reaper path gets exercised end-to-end in dev.
 * Previously these behaviors lived inside LocalMailProvider, which made
 * SIMULATE_REPLIES silently dead under MAIL_DRIVER=postmark.
 */
function makeProvider({ ignoreRate }: { ignoreRate: number }) {
  const config = {
    simulateReplyIgnoreRate: ignoreRate,
    simulateReplyRounds: 1,
    publicBaseUrl: 'http://localhost:0',
    webhookInboundAuth: {},
  };
  const inner = { send: jest.fn(async (args: SendMailArgs) => ({ externalId: `ext-${args.subject}` })) };
  const ai = { complete: jest.fn(async () => 'we can help, 100 USD') };
  return { provider: new SimulatedRepliesMailProvider(inner as never, config as never, ai as never), config, inner };
}

const mail = (replyTo: string) => ({ kind: MailKind.Outreach, replyTo, to: 'provider@example.com', subject: 'Inquiry', body: 'price?' });

describe('SimulatedRepliesMailProvider — simulated replies, follow-ups and ignoring providers', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('delegates the real send to the wrapped transport and returns its externalId', async () => {
    const { provider, inner } = makeProvider({ ignoreRate: 0 });
    const result = await provider.send(mail('t0@reply.example'));
    expect(inner.send).toHaveBeenCalledTimes(1);
    expect(result.externalId).toBe('ext-Inquiry');
  });

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
    const { provider, inner } = makeProvider({ ignoreRate: 1 });
    await provider.send(mail('t2@reply.example'));
    await provider.send(mail('t2@reply.example'));
    expect(jest.getTimerCount()).toBe(0);
    expect(inner.send).toHaveBeenCalledTimes(2); // the emails still go out — the provider just ignores them
  });

  it('a provider who engaged keeps replying even if the ignore roll would now say otherwise', async () => {
    const { provider, config } = makeProvider({ ignoreRate: 0 });
    await provider.send(mail('t3@reply.example'));
    expect(jest.getTimerCount()).toBe(1);
    (config as { simulateReplyIgnoreRate: number }).simulateReplyIgnoreRate = 1; // roll only happens on first contact
    await provider.send(mail('t3@reply.example'));
    expect(jest.getTimerCount()).toBe(2);
  });

  // System mail carries a replyTo too (the questionnaire capability address). Role-playing
  // a "vendor" answer to the customer's own questionnaire would auto-fill it with nonsense.
  it('never role-plays a reply to SYSTEM mail, even though it carries a replyTo', async () => {
    const { provider, inner } = makeProvider({ ignoreRate: 0 });
    await provider.send({ kind: MailKind.System, replyTo: 'q1@reply.example', to: 'jane@gmail.com', subject: 'A few quick questions', body: '?' });
    expect(jest.getTimerCount()).toBe(0);
    expect(inner.send).toHaveBeenCalledTimes(1); // still sent — just not answered
  });
});
