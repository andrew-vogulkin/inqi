import { ReportDto } from '../api/types';

/** Default page size — the picker opens on the last 10 reports. */
export const REPORT_PICKER_PAGE = 10;
/** Keystroke → search debounce, so typing "RPT-260711-01" is one request, not thirteen. */
export const REPORT_SEARCH_DEBOUNCE_MS = 250;
/** Fetch the next page once the list is scrolled within this many px of its end. */
export const LOAD_MORE_THRESHOLD_PX = 120;

/**
 * Append a fetched page onto the already-loaded rows, deduping by id — a report
 * created while the operator scrolls shifts the cursor window and can resend a row.
 */
export function mergeReportPage({ rows, page }: { rows: ReportDto[]; page: ReportDto[] }): ReportDto[] {
  const seen = new Set(rows.map((r) => r.id));
  return [...rows, ...page.filter((r) => !seen.has(r.id))];
}

/** The row's identity label: the human ref (RPT-YYMMDD-NN), else the short id. */
export function reportRefLabel({ report }: { report: Pick<ReportDto, 'id' | 'ref'> }): string {
  return report.ref ?? `#${report.id.slice(0, 8)}`;
}

/** True when the scroll position is near the list end → time to load the next page. */
export function nearListEnd({ scrollTop, clientHeight, scrollHeight, thresholdPx = LOAD_MORE_THRESHOLD_PX }: { scrollTop: number; clientHeight: number; scrollHeight: number; thresholdPx?: number }): boolean {
  return scrollTop + clientHeight >= scrollHeight - thresholdPx;
}
