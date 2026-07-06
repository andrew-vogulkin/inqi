import { NotificationKind, ReportState } from '@inqi/shared';
import { ReportLifecycleEvent, lifecycleEventForState, notificationForLifecycle } from './report-lifecycle';

/**
 * The report lifecycle, mocked end-to-end: every workflow outcome maps to its
 * customer-visible lifecycle event, and every event to its handler (email or
 * silence). This spec IS the lifecycle contract — change the table, change this.
 */
describe('report lifecycle — state → event → handler', () => {
  it('walks every customer-visible moment to its lifecycle event', () => {
    expect(lifecycleEventForState(ReportState.RECEIVED)).toBe(ReportLifecycleEvent.Created);
    expect(lifecycleEventForState(ReportState.QUESTIONNAIRE_SENT)).toBe(ReportLifecycleEvent.NeedsYou);
    expect(lifecycleEventForState(ReportState.REPORT_DELIVERED)).toBe(ReportLifecycleEvent.Delivered);
    expect(lifecycleEventForState(ReportState.DENIED)).toBe(ReportLifecycleEvent.Denied);
    expect(lifecycleEventForState(ReportState.DROPPED)).toBe(ReportLifecycleEvent.Dropped);
    expect(lifecycleEventForState(ReportState.FAILED)).toBe(ReportLifecycleEvent.Failed);
    expect(lifecycleEventForState(ReportState.CANCELLED)).toBe(ReportLifecycleEvent.Cancelled);
  });

  it('internal processing states emit no lifecycle event', () => {
    for (const s of [ReportState.PRE_RESEARCH, ReportState.ENRICHMENT, ReportState.BROAD_RESEARCH, ReportState.FUNNEL, ReportState.OUTREACH, ReportState.REPORT_GENERATION, ReportState.ON_HOLD]) {
      expect(lifecycleEventForState(s)).toBeNull();
    }
  });

  it('created → received ack; needs-you → questionnaire request; done → report-ready; updated → report-updated', () => {
    expect(notificationForLifecycle(ReportLifecycleEvent.Created)).toBe(NotificationKind.ReportReceived);
    expect(notificationForLifecycle(ReportLifecycleEvent.NeedsYou)).toBe(NotificationKind.QuestionnaireRequest);
    expect(notificationForLifecycle(ReportLifecycleEvent.Delivered)).toBe(NotificationKind.ReportReady);
    expect(notificationForLifecycle(ReportLifecycleEvent.Updated)).toBe(NotificationKind.ReportUpdated);
  });

  it('denied emails the denial; dropped/failed/cancelled stay silent', () => {
    expect(notificationForLifecycle(ReportLifecycleEvent.Denied)).toBe(NotificationKind.Denial);
    expect(notificationForLifecycle(ReportLifecycleEvent.Dropped)).toBeNull();   // reminder already warned pre-expiry
    expect(notificationForLifecycle(ReportLifecycleEvent.Failed)).toBeNull();    // operator concern; run costs nothing
    expect(notificationForLifecycle(ReportLifecycleEvent.Cancelled)).toBeNull(); // the customer initiated it
  });
});
