import { describe, it, expect } from 'vitest';
import { ReportDto } from '../api/types';
import { mergeReportPage, reportRefLabel, nearListEnd } from './report-picker';

const row = (id: string, ref?: string | null): ReportDto =>
  ({ id, ref, rawRequest: 'x', state: 'OUTREACH', customerEmail: 'c@x.io', createdAt: '2026-07-11T00:00:00.000Z' } as ReportDto);

describe('mergeReportPage', () => {
  it('appends a page in order', () => {
    const merged = mergeReportPage({ rows: [row('a')], page: [row('b'), row('c')] });
    expect(merged.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('dedupes rows resent by a shifted cursor window', () => {
    const merged = mergeReportPage({ rows: [row('a'), row('b')], page: [row('b'), row('c')] });
    expect(merged.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('an empty page is a no-op', () => {
    expect(mergeReportPage({ rows: [row('a')], page: [] }).map((r) => r.id)).toEqual(['a']);
  });
});

describe('reportRefLabel', () => {
  it('prefers the human ref', () => {
    expect(reportRefLabel({ report: row('clz1abcd0000xy', 'RPT-260711-01') })).toBe('RPT-260711-01');
  });
  it('falls back to the short id on legacy rows (no ref)', () => {
    expect(reportRefLabel({ report: row('clz1abcd0000xy', null) })).toBe('#clz1abcd');
  });
});

describe('nearListEnd', () => {
  it('fires within the threshold of the end', () => {
    expect(nearListEnd({ scrollTop: 800, clientHeight: 300, scrollHeight: 1200, thresholdPx: 120 })).toBe(true);
  });
  it('stays quiet while there is plenty left to scroll', () => {
    expect(nearListEnd({ scrollTop: 0, clientHeight: 300, scrollHeight: 1200, thresholdPx: 120 })).toBe(false);
  });
  it('a list shorter than the viewport counts as at-the-end (first page may under-fill)', () => {
    expect(nearListEnd({ scrollTop: 0, clientHeight: 300, scrollHeight: 200 })).toBe(true);
  });
});
