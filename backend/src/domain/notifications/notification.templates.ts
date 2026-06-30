import { NotificationKind } from '@inqi/shared';

/** Context for rendering a customer notification. Keep bodies minimal — no sensitive data. */
export interface TemplateContext {
  reportUrl?: string;
  questionnaireUrl?: string;
  expiresAt?: Date;
  reason?: string;
}

export interface RenderedTemplate { subject: string; body: string }

/** Pure: render the email subject+body for a notification kind. Links are capability-token (no login). */
export function renderNotification({ kind, ctx }: { kind: NotificationKind; ctx: TemplateContext }): RenderedTemplate {
  switch (kind) {
    case NotificationKind.ReportReady:
      return {
        subject: 'Your inqi report is ready',
        body: `Good news — your research report is ready.\n\nView it here: ${ctx.reportUrl}\n\n— inqi`,
      };
    case NotificationKind.QuestionnaireReminder:
      return {
        subject: 'Reminder: confirm your inqi request',
        body: `Just a reminder to confirm your request so we can start researching.\n\nConfirm here: ${ctx.questionnaireUrl}\n\nThis link expires ${ctx.expiresAt ? ctx.expiresAt.toISOString() : 'soon'}.\n\n— inqi`,
      };
    case NotificationKind.Denial:
      return {
        subject: 'About your inqi request',
        body: `We're sorry — we can't proceed with this request.\n\nReason: ${ctx.reason ?? 'it falls outside what inqi can help with'}.\n\n— inqi`,
      };
    default:
      return { subject: 'inqi', body: '' };
  }
}

/**
 * Pure: is a questionnaire-expiry reminder due? Due only when it's unfilled, no
 * reminder has been sent, and `now` is inside the lead window before expiry (and
 * not already expired). One reminder per questionnaire is enforced at the call
 * site via a claim-then-send on `reminderSentAt`.
 */
export function isReminderDue({ now, expiresAt, leadHours, filledAt, reminderSentAt }: {
  now: Date; expiresAt: Date; leadHours: number; filledAt: Date | null; reminderSentAt: Date | null;
}): boolean {
  if (filledAt || reminderSentAt) return false;
  const windowStart = expiresAt.getTime() - leadHours * 3600_000;
  return now.getTime() >= windowStart && now.getTime() < expiresAt.getTime();
}
