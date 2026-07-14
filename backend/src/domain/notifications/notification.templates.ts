import { NotificationKind } from '@inqi/shared';

/** A ranked option as it appears in the email (freemium-locked reports pass none). */
export interface TemplateOption { name: string; price?: number | null; currency?: string | null; link?: string | null }

/** Context for rendering a customer notification. Keep bodies minimal — no sensitive data. */
export interface TemplateContext {
  reportUrl?: string;
  questionnaireUrl?: string;
  expiresAt?: Date;
  reason?: string;
  /** The customer's own request wording (created ack). */
  request?: string;
  /** Report details (delivered/updated): the synthesized summary + the top-ranked options. */
  summary?: string;
  options?: TemplateOption[];
}

export interface RenderedTemplate { subject: string; body: string }

/** The "1. Name — 5000 THB\n   <direct link>" ranking lines shared by the delivered/updated emails. */
function rankingLines(options: TemplateOption[]): string {
  return options
    .map((o, i) => {
      const head = `${i + 1}. ${o.name}${o.price != null ? ` — ${o.price} ${o.currency ?? ''}`.trimEnd() : ''}`;
      return o.link ? `${head}\n   ${o.link}` : head;
    })
    .join('\n');
}

/** The optional details block (short summary + top ranking with direct links) — empty for locked freemium reports. */
function detailsBlock(ctx: TemplateContext): string {
  const parts: string[] = [];
  if (ctx.summary) parts.push(shorten(ctx.summary, 400));
  if (ctx.options?.length) parts.push(`Top options:\n${rankingLines(ctx.options)}`);
  return parts.length ? `\n\n${parts.join('\n\n')}` : '';
}

/** Keep email summaries short — first sentences up to a cap, never mid-word. */
function shorten(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
  return `${(end > max * 0.5 ? cut.slice(0, end + 1) : cut).trim()}…`;
}

/** Pure: render the email subject+body for a notification kind. Links are capability-token (no login). */
export function renderNotification({ kind, ctx }: { kind: NotificationKind; ctx: TemplateContext }): RenderedTemplate {
  switch (kind) {
    case NotificationKind.ReportReceived:
      return {
        subject: 'We received your inqi request',
        body: `Thanks — we've got your request${ctx.request ? `:\n\n"${ctx.request}"` : '.'}\n\nWe're pre-researching it now; you'll get a short questionnaire to confirm the scope before agents start reaching out.\n\nTrack progress here: ${ctx.reportUrl}\n\n— inqi`,
      };
    case NotificationKind.QuestionnaireRequest:
      return {
        subject: 'inqi needs you: confirm the scope of your request',
        body: `We pre-researched your request — a few quick questions will make the research sharp.\n\nConfirm the scope here: ${ctx.questionnaireUrl}${ctx.expiresAt ? `\n\nThis link expires ${ctx.expiresAt.toISOString()}.` : ''}\n\nResearch starts as soon as you confirm.\n\n— inqi`,
      };
    case NotificationKind.ReportReady:
      return {
        subject: 'Your inqi report is ready',
        body: `Good news — your research report is ready.${detailsBlock(ctx)}\n\nView it here: ${ctx.reportUrl}\n\n— inqi`,
      };
    case NotificationKind.ReportUpdated:
      return {
        subject: 'Your inqi report was updated',
        body: `New information arrived after your report was delivered (a provider reply or late research), so we re-evaluated the ranking.${detailsBlock(ctx)}\n\nSee the updated report: ${ctx.reportUrl}\n\n— inqi`,
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
