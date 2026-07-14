import { IntakeService } from './intake.service';

function make({ intake = ['intake_inqi@monkeycode.io'], balance = 5, account = true, minCredits = 1 }: {
  intake?: string[]; balance?: number; account?: boolean; minCredits?: number;
} = {}) {
  const customers = {
    findByEmail: jest.fn().mockResolvedValue(account ? { id: 'c1', email: 'ada@x.io' } : null),
    upsertByEmail: jest.fn().mockResolvedValue({ id: 'c1', email: 'ada@x.io' }),
  };
  const reports = { createFromEmail: jest.fn().mockResolvedValue({ id: 'r1', ref: 'RPT-260713-05' }) };
  const config = { intakeAddresses: intake, intakeMinCredits: minCredits, webBaseUrl: 'https://inqi.test' };
  const credits = { balance: jest.fn().mockResolvedValue(balance) };
  const mail = { send: jest.fn().mockResolvedValue({ externalId: '<x>' }) };
  const svc = new IntakeService(customers as never, reports as never, config as never, credits as never, mail as never);
  return { svc, customers, reports, credits, mail };
}

describe('IntakeService (HP-27)', () => {
  it('matches the intake address case-insensitively; ignores other addresses', () => {
    const { svc } = make();
    expect(svc.isIntakeAddress('Intake_Inqi@Monkeycode.io')).toBe(true);
    expect(svc.isIntakeAddress('intake_inqi@monkeycode.io')).toBe(true);
    expect(svc.isIntakeAddress('someone@else.com')).toBe(false);
    expect(svc.isIntakeAddress(undefined)).toBe(false);
  });

  it('is disabled when no intake address is configured', () => {
    const { svc } = make({ intake: [] });
    expect(svc.isIntakeAddress('intake_inqi@monkeycode.io')).toBe(false);
  });

  // Intake must be RECEIVED by the inbound provider, so more than one address can be
  // live at once: the provider's own inbound address and a branded one on the MX domain.
  it('accepts ANY of several configured intake addresses', () => {
    const { svc } = make({ intake: ['4599a2a2@inbound.postmarkapp.com', 'intake@inqi-postmark-reply.monkeycode.io'] });
    expect(svc.isIntakeAddress('4599a2a2@inbound.postmarkapp.com')).toBe(true);
    expect(svc.isIntakeAddress('Intake@Inqi-Postmark-Reply.Monkeycode.io')).toBe(true);
    expect(svc.isIntakeAddress('intake_inqi@monkeycode.io')).toBe(false); // not configured → not intake
  });

  // The intake mailbox is on Google Workspace, which FORWARDS into Postmark's inbound
  // address — so the delivered address is Postmark's hash, not the intake mailbox. If we
  // only matched the delivered address, no real intake email would ever open a report.
  it('recognizes a FORWARDED intake email, where the delivered address is the forwarder\'s', () => {
    const { svc } = make();
    expect(svc.isIntake({
      toAddr: 'a1b2c3@inbound.postmarkapp.com',              // delivered address (Postmark)
      recipients: ['a1b2c3@inbound.postmarkapp.com', 'intake_inqi@monkeycode.io'], // original To survives
    })).toBe(true);
  });

  it('does not treat an unrelated forwarded email as intake', () => {
    const { svc } = make();
    expect(svc.isIntake({
      toAddr: 'a1b2c3@inbound.postmarkapp.com',
      recipients: ['a1b2c3@inbound.postmarkapp.com', 'hello@monkeycode.io'],
    })).toBe(false);
  });

  it('still matches a directly-delivered intake email (no forwarder)', () => {
    const { svc } = make();
    expect(svc.isIntake({ toAddr: 'intake_inqi@monkeycode.io', recipients: ['intake_inqi@monkeycode.io'] })).toBe(true);
  });

  it('creates a report owned by the sender, folding the subject into the request', async () => {
    const { svc, reports } = make({ balance: 5 });
    const ack = await svc.createReportFromEmail({ fromAddr: 'Ada@X.io', subject: 'Need a photographer', body: 'in Bali, December, 2 days' });
    expect(reports.createFromEmail).toHaveBeenCalledWith(expect.objectContaining({
      rawRequest: 'Need a photographer\n\nin Bali, December, 2 days',
      customer: { id: 'c1', email: 'ada@x.io' },
    }));
    expect(ack).toEqual({ intake: true, reportId: 'r1', ref: 'RPT-260713-05' });
  });

  it('rejects an intake email with no From address (no owner)', async () => {
    const { svc } = make();
    await expect(svc.createReportFromEmail({ body: 'hi' })).rejects.toThrow(/no From/);
  });
});

/**
 * The credit gate. Email intake is unauthenticated — the balance IS the authorization.
 * A refused email must cost us nothing: no account, no report, no pipeline.
 */
describe('IntakeService — credit gate', () => {
  it('runs the report when the sender can pay for it (balance >= min)', async () => {
    const { svc, reports, mail } = make({ balance: 1, minCredits: 1 });
    const ack = await svc.createReportFromEmail({ fromAddr: 'ada@x.io', body: 'find me a car' });
    expect(ack.refused).toBeUndefined();
    expect(reports.createFromEmail).toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('REFUSES a sender with no account — and never enrolls them', async () => {
    const { svc, reports, customers, mail } = make({ account: false });
    const ack = await svc.createReportFromEmail({ fromAddr: 'stranger@evil.com', body: 'find me a car' });
    expect(ack).toEqual({ intake: true, reportId: '', ref: null, refused: true });
    expect(customers.upsertByEmail).not.toHaveBeenCalled(); // emailing us must not create an account…
    expect(reports.createFromEmail).not.toHaveBeenCalled(); // …nor burn any tokens
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'stranger@evil.com' }));
  });

  it('REFUSES a known customer who is short on credits, and tells them to top up', async () => {
    const { svc, reports, mail } = make({ balance: 0, minCredits: 1 });
    const ack = await svc.createReportFromEmail({ fromAddr: 'ada@x.io', body: 'find me a car' });
    expect(ack.refused).toBe(true);
    expect(reports.createFromEmail).not.toHaveBeenCalled();
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ada@x.io',
      body: expect.stringContaining('Credits available: 0'),
    }));
  });

  it('honours a higher threshold (INTAKE_MIN_CREDITS=2 turns away a 1-credit sender)', async () => {
    const { svc, reports } = make({ balance: 1, minCredits: 2 });
    expect((await svc.createReportFromEmail({ fromAddr: 'ada@x.io', body: 'x' })).refused).toBe(true);
    expect(reports.createFromEmail).not.toHaveBeenCalled();
  });

  // Without a cooldown, a mail loop pointed at the intake address turns us into a
  // spam reflector: one outbound refusal for every inbound message.
  it('replies at most once per sender within the cooldown', async () => {
    const { svc, mail } = make({ account: false });
    await svc.createReportFromEmail({ fromAddr: 'stranger@evil.com', body: 'a' });
    await svc.createReportFromEmail({ fromAddr: 'stranger@evil.com', body: 'b' });
    await svc.createReportFromEmail({ fromAddr: 'stranger@evil.com', body: 'c' });
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('a failing refusal reply never breaks inbound processing', async () => {
    const { svc, mail } = make({ account: false });
    mail.send.mockRejectedValueOnce(new Error('postmark down'));
    await expect(svc.createReportFromEmail({ fromAddr: 'stranger@evil.com', body: 'x' })).resolves.toMatchObject({ refused: true });
  });
});
