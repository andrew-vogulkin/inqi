import { formatReportRef, reportRefPrefix } from './report-ref';

describe('report refs (option C): RPT-YYMMDD-NN', () => {
  const day = new Date('2026-07-07T15:30:00Z');

  it('formats date-coded refs with a zero-padded per-day counter', () => {
    expect(formatReportRef({ date: day, seq: 3 })).toBe('RPT-260707-03');
    expect(formatReportRef({ date: day, seq: 42 })).toBe('RPT-260707-42');
  });

  it('grows past two digits on a busy day instead of overflowing', () => {
    expect(formatReportRef({ date: day, seq: 104 })).toBe('RPT-260707-104');
  });

  it('uses the UTC date — a submit late at night in UTC+ never jumps a day', () => {
    expect(reportRefPrefix({ date: new Date('2026-12-31T23:59:59Z') })).toBe('RPT-261231-');
    expect(reportRefPrefix({ date: new Date('2027-01-01T00:00:01Z') })).toBe('RPT-270101-');
  });
});
