import { useEffect, useRef, useState, UIEvent } from 'react';
import { color, font, fontSize, fontWeight, radius } from '../theme/tokens';
import { adminApi } from '../api';
import { ReportDto } from '../api/types';
import { Modal } from '../ui';
import { toneForReportState, toneColors } from '../ui/tone';
import { REPORT_SEARCH_DEBOUNCE_MS, mergeReportPage, reportRefLabel, nearListEnd } from '../conventions/report-picker';

/**
 * The operator report picker — a compact trigger showing the active report
 * (RPT ref + request) that opens a search popup: the last 10 reports by default,
 * type to search by ref (RPT-260711-01) / customer email / request text, and
 * infinite scroll walks older pages via the cursor-paginated /admin/reports.
 * Replaces the unbounded pill-tab lists on the live board / run controls / cost.
 */
export function ReportPicker({ activeId, onPick, onDefault }: {
  activeId: string | null;
  onPick: (report: ReportDto) => void;
  /** Fired once after the initial page loads: the most recent report, or null when there are none. */
  onDefault?: (report: ReportDto | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ReportDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Every row ever fetched, for the trigger label — the active report may have
  // scrolled out of the current search's rows.
  const known = useRef(new Map<string, ReportDto>());
  const seq = useRef(0); // stale-response guard: only the latest request may commit

  async function fetchPage({ q, cursor }: { q: string; cursor?: string }) {
    const mySeq = ++seq.current;
    setLoading(true);
    try {
      const page = await adminApi.searchReports({ q, cursor });
      if (mySeq !== seq.current) return null; // a newer search superseded this one
      page.rows.forEach((r) => known.current.set(r.id, r));
      setRows((prev) => (cursor ? mergeReportPage({ rows: prev, page: page.rows }) : page.rows));
      setNextCursor(page.nextCursor);
      return page;
    } catch {
      return null; // transient failure: keep what's shown; the next keystroke/scroll retries
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }

  // Initial page: feeds the trigger label AND resolves the default selection.
  useEffect(() => {
    fetchPage({ q: '' }).then((page) => { if (page) onDefault?.(page.rows[0] ?? null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced live search while the popup is open (query '' = the latest reports).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { void fetchPage({ q: query }); }, REPORT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query]);

  function onScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (!loading && nextCursor && nearListEnd({ scrollTop: el.scrollTop, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight })) {
      void fetchPage({ q: query, cursor: nextCursor });
    }
  }

  function pick(report: ReportDto) {
    setOpen(false);
    onPick(report);
  }

  const active = activeId ? known.current.get(activeId) : null;

  return (
    <>
      <button
        data-testid="report-picker-trigger"
        onClick={() => { setQuery(''); setOpen(true); }}
        title="Search reports by ref, customer or request"
        style={{ display: 'flex', alignItems: 'center', gap: 9, maxWidth: 340, padding: '7px 12px', borderRadius: radius.md, border: `1px solid ${color.lineStrong}`, background: color.surface, cursor: 'pointer', textAlign: 'left' }}>
        <span aria-hidden style={{ color: color.subtle, fontSize: fontSize.sm }}>⌕</span>
        {active
          ? <>
              <span style={{ fontFamily: font.mono, fontSize: fontSize.xs, color: color.inkSoft, flex: 'none' }}>{reportRefLabel({ report: active })}</span>
              <span style={{ fontSize: 12.5, color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{active.rawRequest}</span>
            </>
          : <span style={{ fontSize: 12.5, color: color.muted }}>{activeId ? `#${activeId.slice(0, 8)}` : 'Select a report'}</span>}
        <span aria-hidden style={{ color: color.subtle, fontSize: fontSize.xs, marginLeft: 'auto', flex: 'none' }}>▾</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Select a report">
        <input
          data-testid="report-search-input"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="RPT-260711-01, customer email, or request text…"
          style={{ width: '100%', height: 40, padding: '0 12px', border: `1.5px solid ${color.lineStrong}`, borderRadius: radius.md, fontSize: fontSize.base, fontFamily: font.ui, color: color.ink, background: color.surface, outline: 'none', marginBottom: 10 }}
        />
        <div data-testid="report-picker-list" onScroll={onScroll} style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((r) => {
            const tone = toneColors[toneForReportState(r.state)];
            const on = r.id === activeId;
            return (
              <button key={r.id} data-testid="report-picker-row" onClick={() => pick(r)}
                style={{ textAlign: 'left', padding: '9px 11px', borderRadius: radius.md, border: `1px solid ${on ? color.brand : color.line}`, background: on ? color.brandTint : color.surface, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: font.mono, fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: color.inkSoft, flex: 'none' }}>{reportRefLabel({ report: r })}</span>
                  <span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, padding: '2px 8px', borderRadius: radius.pill, background: tone.bg, color: tone.fg, flex: 'none' }}>{r.state}</span>
                  <span style={{ fontSize: fontSize.xs, color: color.subtle, marginLeft: 'auto', fontFamily: font.mono, flex: 'none' }}>{new Date(r.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div style={{ fontSize: 12.5, color: color.ink, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.rawRequest}</div>
                <div style={{ fontSize: fontSize.xs, color: color.subtle, marginTop: 1 }}>{r.customerEmail}</div>
              </button>
            );
          })}
          {!loading && rows.length === 0 && (
            <div data-testid="report-picker-empty" style={{ padding: '18px 6px', textAlign: 'center', color: color.subtle, fontSize: fontSize.sm }}>
              {query ? `No reports match “${query}”.` : 'No reports yet.'}
            </div>
          )}
          {loading && <div style={{ padding: '10px 6px', textAlign: 'center', color: color.subtle, fontSize: fontSize.xs }}>Loading…</div>}
        </div>
        <div style={{ marginTop: 8, fontSize: fontSize.xs, color: color.subtle, display: 'flex', justifyContent: 'space-between' }}>
          <span>{query ? 'Matching ref · customer · request' : 'Latest reports'}</span>
          {nextCursor && <span>scroll for older ↓</span>}
        </div>
      </Modal>
    </>
  );
}
