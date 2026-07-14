import { IntakeService } from './intake.service';

function make({ intake = 'intake_inqi@monkeycode.io' }: { intake?: string } = {}) {
  const customers = { upsertByEmail: jest.fn().mockResolvedValue({ id: 'c1', email: 'ada@x.io' }) };
  const reports = { createFromEmail: jest.fn().mockResolvedValue({ id: 'r1', ref: 'RPT-260713-05' }) };
  const config = { intakeAddress: intake };
  return { svc: new IntakeService(customers as never, reports as never, config as never), customers, reports };
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
    const { svc } = make({ intake: '' });
    expect(svc.isIntakeAddress('intake_inqi@monkeycode.io')).toBe(false);
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
    const { svc, customers, reports } = make();
    const ack = await svc.createReportFromEmail({ fromAddr: 'Ada@X.io', subject: 'Need a photographer', body: 'in Bali, December, 2 days' });
    expect(customers.upsertByEmail).toHaveBeenCalledWith({ email: 'ada@x.io' }); // normalized
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
