import { NotificationService } from './notification.service';

/** Minimal harness for the ops freemium-alert fan-out (no queue/init needed — we call the handler directly). */
function makeService({ report, admins }: { report: unknown; admins: string[] }) {
  const repo = { findReport: jest.fn(async () => report), findAdminEmails: jest.fn(async () => admins) };
  const channel = { send: jest.fn(async (_m: { to: string; subject: string; body: string }) => undefined) };
  const boss = { work: jest.fn(), enqueue: jest.fn() };
  const outbox = { emit: jest.fn(async () => undefined) };
  const config = { webBaseUrl: 'https://inqi.test' };
  const usage = { recordAction: jest.fn(async () => undefined) };
  const svc = new NotificationService(repo as never, boss as never, outbox as never, config as never, channel as never, usage as never);
  return { svc, repo, channel, outbox, usage };
}

/** Invoke the private handler the queue worker calls. */
const runAlert = (svc: NotificationService, reportId: string) =>
  (svc as unknown as { notifyAdminsOfFreemium(a: { reportId: string }): Promise<void> }).notifyAdminsOfFreemium({ reportId });

describe('NotificationService — freemium admin alert (ops tracking)', () => {
  const report = { id: 'r1', ref: 'RPT-260707-09', customerEmail: 'buyer@x.io', rawRequest: 'a vintage Porsche 911' };

  it('emails EVERY admin with the customer, ref, request, and a report link', async () => {
    const { svc, channel } = makeService({ report, admins: ['ops@inqi.example', 'marlowe@monkeycode.io'] });
    await runAlert(svc, 'r1');
    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(channel.send.mock.calls.map((c) => c[0].to)).toEqual(['ops@inqi.example', 'marlowe@monkeycode.io']);
    const msg = channel.send.mock.calls[0][0];
    expect(msg.subject).toContain('RPT-260707-09');
    expect(msg.subject).toContain('a vintage Porsche 911');
    expect(msg.body).toContain('buyer@x.io');
    expect(msg.body).toContain('a vintage Porsche 911');
    expect(msg.body).toContain('https://inqi.test/#/r/r1');
  });

  it('no admins configured → sends nothing (does not throw)', async () => {
    const { svc, channel } = makeService({ report, admins: [] });
    await runAlert(svc, 'r1');
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('missing report → no-op', async () => {
    const { svc, channel } = makeService({ report: null, admins: ['ops@inqi.example'] });
    await runAlert(svc, 'gone');
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('does NOT emit into the report activity timeline (admin addresses stay internal)', async () => {
    const { svc, outbox } = makeService({ report, admins: ['ops@inqi.example'] });
    await runAlert(svc, 'r1');
    expect(outbox.emit).not.toHaveBeenCalled();
  });
});
