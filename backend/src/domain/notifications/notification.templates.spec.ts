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
