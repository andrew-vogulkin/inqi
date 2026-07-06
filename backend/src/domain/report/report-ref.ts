/**
 * Human-facing report references (option C): `RPT-YYMMDD-NN` — date-coded with a
 * per-day counter. Short enough to speak, groups naturally by day, and needs no
 * global sequence. The counter starts at 01 each day and simply grows past two
 * digits on a busy day (RPT-260707-104). Dates are UTC so the ref never depends
 * on server timezone.
 */
export const REPORT_REF_PREFIX = 'RPT';

/** `RPT-260707-` — the shared prefix of every ref minted on `date` (UTC). */
export function reportRefPrefix({ date }: { date: Date }): string {
  const iso = date.toISOString(); // 2026-07-07T…
  return `${REPORT_REF_PREFIX}-${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-`;
}

/** `RPT-260707-03` — the ref for the `seq`-th report of the day (1-based, zero-padded to 2). */
export function formatReportRef({ date, seq }: { date: Date; seq: number }): string {
  return `${reportRefPrefix({ date })}${String(seq).padStart(2, '0')}`;
}
