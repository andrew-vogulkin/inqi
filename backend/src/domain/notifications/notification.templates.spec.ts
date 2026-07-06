import { NotificationKind } from '@inqi/shared';
import { isReminderDue, renderNotification } from './notification.templates';

describe('renderNotification', () => {
  it('report-ready includes the report webview link', () => {
    const t = renderNotification({ kind: NotificationKind.ReportReady, ctx: { reportUrl: 'https://app/r/abc' } });
    expect(t.subject).toMatch(/report is ready/i);
    expect(t.body).toContain('https://app/r/abc');
  });
  it('reminder includes the questionnaire link + expiry', () => {
    const t = renderNotification({ kind: NotificationKind.QuestionnaireReminder, ctx: { questionnaireUrl: 'https://app/q/tok', expiresAt: new Date('2026-07-01T00:00:00Z') } });
    expect(t.body).toContain('https://app/q/tok');
    expect(t.body).toContain('2026-07-01');
  });
  it('denial includes the reason', () => {
    const t = renderNotification({ kind: NotificationKind.Denial, ctx: { reason: 'prohibited item' } });
    expect(t.body).toContain('prohibited item');
  });
  it('report-received acks with the customer own wording + tracking link', () => {
    const t = renderNotification({ kind: NotificationKind.ReportReceived, ctx: { reportUrl: 'https://app/r/abc', request: 'a padel coach in Lisbon' } });
    expect(t.subject).toMatch(/received/i);
    expect(t.body).toContain('a padel coach in Lisbon');
    expect(t.body).toContain('https://app/r/abc');
  });
  it('questionnaire-request (needs-you) carries the capability link + expiry', () => {
    const t = renderNotification({ kind: NotificationKind.QuestionnaireRequest, ctx: { questionnaireUrl: 'https://app/q/tok', expiresAt: new Date('2026-07-05T00:00:00Z') } });
    expect(t.subject).toMatch(/needs you/i);
    expect(t.body).toContain('https://app/q/tok');
    expect(t.body).toContain('2026-07-05');
  });
  it('report-ready with details lists the top ranking + summary', () => {
    const t = renderNotification({ kind: NotificationKind.ReportReady, ctx: {
      reportUrl: 'https://app/r/abc', summary: 'Aurora is the best fit.',
      options: [{ name: 'Aurora', price: 200, currency: 'EUR' }, { name: 'Borealis', price: 250, currency: 'EUR' }],
    } });
    expect(t.body).toContain('1. Aurora — 200 EUR');
    expect(t.body).toContain('2. Borealis — 250 EUR');
    expect(t.body).toContain('Aurora is the best fit.');
    expect(t.body).toContain('https://app/r/abc');
  });
  it('report-updated explains the re-evaluation and carries the new ranking', () => {
    const t = renderNotification({ kind: NotificationKind.ReportUpdated, ctx: {
      reportUrl: 'https://app/r/abc', summary: 'Borealis now leads.',
      options: [{ name: 'Borealis', price: 250, currency: 'EUR' }],
    } });
    expect(t.subject).toMatch(/updated/i);
    expect(t.body).toMatch(/re-evaluated/i);
    expect(t.body).toContain('1. Borealis — 250 EUR');
    expect(t.body).toContain('https://app/r/abc');
  });
  it('no details (locked freemium) → the delivered email is just the link, no ranking leak', () => {
    const t = renderNotification({ kind: NotificationKind.ReportReady, ctx: { reportUrl: 'https://app/r/abc' } });
    expect(t.body).not.toMatch(/Top options/);
    expect(t.body).toContain('https://app/r/abc');
  });
});

describe('isReminderDue', () => {
  const expiresAt = new Date('2026-07-02T00:00:00Z');
  const base = { expiresAt, leadHours: 24, filledAt: null as Date | null, reminderSentAt: null as Date | null };
  it('due inside the lead window', () => {
    expect(isReminderDue({ ...base, now: new Date('2026-07-01T06:00:00Z') })).toBe(true);
  });
  it('not due before the window opens', () => {
    expect(isReminderDue({ ...base, now: new Date('2026-06-30T00:00:00Z') })).toBe(false);
  });
  it('not due after expiry', () => {
    expect(isReminderDue({ ...base, now: new Date('2026-07-02T01:00:00Z') })).toBe(false);
  });
  it('not due once filled', () => {
    expect(isReminderDue({ ...base, now: new Date('2026-07-01T06:00:00Z'), filledAt: new Date() })).toBe(false);
  });
  it('not due once a reminder was already sent', () => {
    expect(isReminderDue({ ...base, now: new Date('2026-07-01T06:00:00Z'), reminderSentAt: new Date() })).toBe(false);
  });
});
