import { CSSProperties, useEffect, useState } from 'react';
import { EventType, InquiryStage } from '@inqi/shared';
import { AsyncStatus, ReportLayout, StatusTone } from '../conventions/enums';
import { statusBadge } from '../conventions/stages';
import { Route, hrefFor, navigate } from '../conventions/routes';
import { RankedOption, optionId } from '../conventions/ranking';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { inquiriesApi, reportsApi, ApiError } from '../api';
import { EmptyState, ErrorState, Skeleton } from '../ui';
import { toneColors } from '../ui/tone';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtime } from '../realtime/socket';
import { ReportState, TimelineItem } from '../state/report.reducer';

const PAGE: CSSProperties = { maxWidth: 900, margin: '0 auto' };
const META_CHIP: CSSProperties = { fontSize: fontSize.sm, color: color.inkSoft, background: color.surfaceSunken, padding: '4px 9px', borderRadius: radius.sm };

/** FE-06 — the centerpiece. Drives /i/:id (owner) and /r/:token (public deep link). */
export function LiveReport({ inquiryId, token }: { inquiryId?: string; token?: string }) {
  const dispatch = useAppDispatch();
  const report = useSelector((s) => s.report);
  const [resolvedId, setResolvedId] = useState<string | null>(inquiryId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<ReportLayout>(ReportLayout.List);
  const [activityOpen, setActivityOpen] = useState(false);
  const [scope, setScope] = useState<ScopeData | null>(null);

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: ActionType.ReportCleared });
    (async () => {
      try {
        if (inquiryId) { if (!cancelled) setResolvedId(inquiryId); return; }
        if (token) { const rep = await reportsApi.getByToken({ token }); if (!cancelled) setResolvedId(rep.inquiryId); }
      } catch (e) { if (!cancelled) setError(e instanceof ApiError ? e.message : 'This report link is invalid or has expired.'); }
    })();
    return () => { cancelled = true; };
  }, [inquiryId, token, dispatch]);

  useRealtime(resolvedId ? { kind: 'inquiry', inquiryId: resolvedId } : null);

  useEffect(() => {
    if (!resolvedId) return;
    inquiriesApi.reportLive({ id: resolvedId })
      .then((live) => {
        // Questionnaire stage → there's no report yet; send the owner to the questions + confirm form.
        if (live.stage === InquiryStage.Questionnaire && live.questionnaireToken) {
          navigate({ route: Route.Questionnaire, params: { token: live.questionnaireToken } });
          return;
        }
        dispatch({ type: ActionType.ReportSnapshotReceived, live });
        setScope((live.questionnaire as ScopeData | undefined) ?? null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the report.'));
  }, [resolvedId, report.cursor, dispatch]);

  if (error) return <ErrorState title="Can't open this report" message={error} />;
  if (report.status !== AsyncStatus.Ready) return <div style={{ ...PAGE, padding: '26px 28px' }}><Skeleton width="40%" /><div style={{ height: 12 }} /><Skeleton /><div style={{ height: 8 }} /><Skeleton width="70%" /></div>;

  const options = report.order.map((id) => report.optionsById[id]);
  const streaming = !report.delivered;
  const badge = statusBadge(report.inquiryState);
  const pillLabel = streaming ? 'Researching' : badge.label;
  const pillTone = streaming ? StatusTone.Info : badge.tone;
  const dossierFor = (o: RankedOption) => report.inquiryId ? hrefFor({ route: Route.Dossier, params: { id: report.inquiryId, ref: optionId(o) } }) : undefined;
  const countLabel = `${options.length} ${options.length === 1 ? 'option' : 'options'}${streaming ? ' so far' : ''}`;

  return (
    <div style={{ ...PAGE, padding: '26px 28px 90px' }}>
      <a href={hrefFor({ route: Route.Dashboard })} style={{ fontSize: fontSize.base, color: color.muted, marginBottom: space[4], display: 'inline-flex', alignItems: 'center', gap: 5 }}>‹ Dashboard</a>

      {report.reusedFrom && (
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '12px 16px', marginBottom: space[4] }}>
          <span style={{ width: 28, height: 28, borderRadius: radius.md, flex: 'none', background: color.infoTint, color: color.info, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↺</span>
          <div style={{ flex: 1, fontSize: fontSize.base, color: color.muted, lineHeight: 1.45 }}><span style={{ color: color.ink, fontWeight: fontWeight.medium }}>Reused from a similar recent report.</span> Gathered for a nearby request — no credit spent.</div>
          <button onClick={() => resolvedId && inquiriesApi.reportLive({ id: resolvedId }).then((live) => dispatch({ type: ActionType.ReportSnapshotReceived, live })).catch(() => undefined)}
            style={{ height: 32, padding: '0 13px', borderRadius: radius.md, background: color.ink, color: color.onSolid, border: 'none', fontSize: fontSize.sm, fontWeight: fontWeight.medium, cursor: 'pointer', flex: 'none' }}>Refresh</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[4], marginBottom: space[5] }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 7px' }}>{report.rawRequest}</h1>
          <div style={{ fontSize: fontSize.sm, color: color.subtle, fontFamily: font.mono }}>#{(report.inquiryId ?? '').slice(0, 8)}</div>
        </div>
        <span data-testid="report-status" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: radius.pill, fontSize: fontSize.base, fontWeight: fontWeight.medium, flex: 'none', background: toneColors[pillTone].bg, color: toneColors[pillTone].fg }}>
          {streaming && <span style={{ width: 7, height: 7, borderRadius: '50%', background: toneColors[pillTone].fg, animation: 'inqi-pulse 1.3s ease-in-out infinite' }} />}
          {pillLabel}
        </span>
      </div>

      {report.delivered && report.summary && (
        <p style={{ fontSize: fontSize.md, color: color.muted, margin: `0 0 ${space[4]}px`, lineHeight: 1.5 }}>{report.summary}</p>
      )}

      {scope && <ScopeSection scope={scope} />}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginBottom: space[4], flexWrap: 'wrap' }}>
        <button onClick={() => dispatch({ type: ActionType.SocketReconnected })} data-testid="reconnect"
          style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: fontSize.sm, color: color.muted, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.pill, padding: '5px 11px', cursor: 'pointer' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color.brand }} /> Live · simulate reconnect
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
          <span style={{ fontSize: fontSize.sm, color: color.subtle }}>Layout</span>
          <LayoutSwitch layout={layout} onChange={setLayout} />
        </div>
      </div>

      {layout === ReportLayout.List ? (
        // List always shows the agent activity — it's the whole story while options are still 0.
        <>
          <AgentActivity report={report} open={activityOpen} onToggle={() => setActivityOpen((v) => !v)} />
          {options.length === 0 && streaming
            ? <div style={{ marginTop: 14 }}><EmptyState title="No options yet" hint="inqi is reaching out — qualified providers appear here live." /></div>
            : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 2px 12px' }}>
                  <div style={{ fontSize: fontSize.base, color: color.muted }}>{countLabel}</div>
                  <div style={{ fontSize: fontSize.sm, color: color.subtle }}>Ranked by public feedback + price</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {options.map((o, i) => <OptionCard key={optionId(o)} option={o} rank={i} best={i === 0} dossierHref={dossierFor(o)} />)}
                  {streaming && <StreamingCard />}
                </div>
              </>
            )}
        </>
      ) : options.length === 0 && streaming
        ? <EmptyState title="No options yet" hint="inqi is still reaching out — results appear here live." />
        : layout === ReportLayout.Split ? <SplitView report={report} options={options} countLabel={countLabel} streaming={streaming} />
          : <TableView options={options} streaming={streaming} />}
    </div>
  );
}

interface ScopeData { questions: { id: string; type: string; prompt: string }[]; answers: Record<string, string> | null; confirmed: boolean }

/** Read-only, expandable view of the scope the customer confirmed (the questionnaire as part of the report). */
function ScopeSection({ scope }: { scope: ScopeData }) {
  const [open, setOpen] = useState(false);
  const fields = scope.questions.filter((q) => q.type !== 'confirm');
  const answeredCount = fields.filter((f) => scope.answers?.[f.id]).length;
  if (fields.length === 0) return null;
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, marginBottom: 14, overflow: 'hidden' }}>
      <button onClick={() => setOpen((v) => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer' }}>
        <span style={{ width: 22, height: 22, borderRadius: radius.sm, flex: 'none', background: color.brandTint, color: color.brandStrong, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.sm }}>✓</span>
        <span style={{ fontSize: fontSize.base, fontWeight: fontWeight.semibold, flex: 'none' }}>Scope you confirmed</span>
        <span style={{ fontSize: fontSize.sm, color: color.muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scope.confirmed ? 'Used to guide the research' : 'Awaiting your confirmation'}</span>
        <span style={{ fontSize: fontSize.xs, color: color.subtle, fontFamily: font.mono, flex: 'none' }}>{answeredCount} answers</span>
        <span style={{ fontSize: 10, color: color.subtle, flex: 'none', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
      </button>
      {open && (
        <div style={{ padding: '4px 16px 12px', borderTop: `1px solid ${color.surfaceSunken}` }}>
          {fields.map((f) => (
            <div key={f.id} style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: `1px solid ${color.surfaceSunken}` }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: fontSize.sm, color: color.muted }}>{f.prompt}</div>
              <div style={{ flex: 'none', maxWidth: '55%', fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: color.ink, textAlign: 'right' }}>{scope.answers?.[f.id] || '—'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LayoutSwitch({ layout, onChange }: { layout: ReportLayout; onChange: (l: ReportLayout) => void }) {
  const opt = (l: ReportLayout, label: string) => {
    const on = layout === l;
    return <button onClick={() => onChange(l)} style={{ border: 'none', cursor: 'pointer', fontSize: fontSize.sm, fontWeight: fontWeight.medium, padding: '5px 11px', borderRadius: radius.sm, background: on ? color.surface : 'transparent', color: on ? color.ink : color.muted, boxShadow: on ? '0 1px 2px rgba(20,20,18,.08)' : undefined }}>{label}</button>;
  };
  return <div style={{ display: 'flex', background: color.surfaceAlt, borderRadius: radius.md, padding: 3, gap: 2 }}>{opt(ReportLayout.List, 'List')}{opt(ReportLayout.Split, 'Split')}{opt(ReportLayout.Table, 'Table')}</div>;
}

/** Layout-A option card (also reused by the freemium teaser). */
export function OptionCard({ option, rank, best, dossierHref }: { option: RankedOption; rank: number; best: boolean; dossierHref?: string }) {
  const bg = (option.background ?? {}) as { rating?: number | null; reviewsCount?: number | null };
  const q = Math.round((option.qualityScore ?? 0) * 100);
  return (
    <div data-testid="option-row" style={{ background: color.surface, border: `1px solid ${best ? color.brand : color.line}`, borderRadius: radius.lg, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 30, height: 30, borderRadius: radius.md, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.md, fontWeight: fontWeight.semibold, fontFamily: font.mono, background: best ? color.brand : color.surfaceSunken, color: best ? color.onSolid : color.muted }}>{rank + 1}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
            <span style={{ fontSize: fontSize.h3, fontWeight: fontWeight.semibold, letterSpacing: '-.01em' }}>{option.subjectProvider}</span>
            {best && <span style={{ fontSize: 10.5, fontWeight: fontWeight.semibold, color: color.brand, background: color.brandTint, padding: '2px 8px', borderRadius: radius.sm, letterSpacing: '.02em' }}>BEST MATCH</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {bg.rating != null && <span style={META_CHIP}>★ {bg.rating}{bg.reviewsCount != null ? ` · ${bg.reviewsCount} reviews` : ''}</span>}
            {option.availability && <span style={META_CHIP}>{option.availability}</span>}
            {option.leadTime && <span style={META_CHIP}>{option.leadTime}</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div style={{ fontSize: fontSize.h2, fontWeight: fontWeight.semibold, letterSpacing: '-.02em' }}>{option.price != null ? `${option.price}` : '—'}<span style={{ fontSize: fontSize.sm, color: color.subtle, fontWeight: fontWeight.regular }}>{option.currency ? ` ${option.currency}` : ''}</span></div>
          <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <div style={{ fontSize: fontSize.xs, color: color.subtle }}>public feedback</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 46, height: 5, borderRadius: 3, background: color.surfaceAlt, overflow: 'hidden' }}><div style={{ width: `${q}%`, height: '100%', background: color.brand }} /></div>
              <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, fontFamily: font.mono }}>{q}</span>
            </div>
          </div>
        </div>
      </div>
      {dossierHref && (
        <a href={dossierHref} style={{ display: 'flex', alignItems: 'center', marginTop: 14, paddingTop: 13, borderTop: `1px solid ${color.surfaceSunken}`, textDecoration: 'none' }}>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: color.brand }}>How inqi researched this →</span>
        </a>
      )}
    </div>
  );
}

function SplitView({ report, options, countLabel, streaming }: { report: ReportState; options: RankedOption[]; countLabel: string; streaming: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      <div style={{ width: 240, flex: 'none', background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '18px 18px 8px', position: 'sticky', top: 8 }}>
        <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: color.subtle, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: space[4] }}>Agent activity</div>
        <TimelineList report={report} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: fontSize.base, color: color.muted, margin: '2px 0' }}>{countLabel} · ranked by public feedback + price</div>
        {options.map((o, i) => {
          const bg = (o.background ?? {}) as { rating?: number | null };
          const qq = Math.round((o.qualityScore ?? 0) * 100);
          return (
            <div key={optionId(o)} data-testid="option-row" style={{ background: color.surface, border: `1px solid ${i === 0 ? color.brand : color.line}`, borderRadius: radius.lg, padding: '15px 17px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 26, height: 26, borderRadius: radius.md, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.base, fontWeight: fontWeight.semibold, fontFamily: font.mono, background: i === 0 ? color.brand : color.surfaceSunken, color: i === 0 ? color.onSolid : color.muted }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: fontSize.lg, fontWeight: fontWeight.semibold }}>{o.subjectProvider}</span>{i === 0 && <span style={{ fontSize: 10, fontWeight: fontWeight.semibold, color: color.brand, background: color.brandTint, padding: '2px 7px', borderRadius: radius.sm }}>BEST</span>}</div>
                <div style={{ fontSize: fontSize.sm, color: color.subtle, marginTop: 3 }}>{bg.rating != null ? `★ ${bg.rating} · ` : ''}{o.availability ?? 'researching'}{o.leadTime ? ` · ${o.leadTime}` : ''}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                <div style={{ width: 38, height: 5, borderRadius: 3, background: color.surfaceAlt, overflow: 'hidden' }}><div style={{ width: `${qq}%`, height: '100%', background: color.brand }} /></div>
                <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, fontFamily: font.mono, color: color.muted, width: 20 }}>{qq}</span>
              </div>
              <div style={{ fontSize: fontSize.h3, fontWeight: fontWeight.semibold, flex: 'none', width: 74, textAlign: 'right' }}>{o.price != null ? o.price : '—'}<span style={{ fontSize: fontSize.xs, color: color.subtle, fontWeight: fontWeight.regular }}>{o.currency ? ` ${o.currency}` : ''}</span></div>
            </div>
          );
        })}
        {streaming && <StreamingCard />}
      </div>
    </div>
  );
}

function TableView({ options, streaming }: { options: RankedOption[]; streaming: boolean }) {
  const head: CSSProperties = { fontSize: fontSize.xs, color: color.subtle, fontWeight: fontWeight.semibold, letterSpacing: '.03em', textTransform: 'uppercase' };
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '11px 18px', borderBottom: `1px solid ${color.surfaceSunken}` }}>
        <div style={{ width: 34, ...head }}>#</div>
        <div style={{ flex: 1, ...head }}>Provider</div>
        <div style={{ width: 120, ...head }}>Availability</div>
        <div style={{ width: 80, textAlign: 'center', ...head }}>Feedback</div>
        <div style={{ width: 74, textAlign: 'right', ...head }}>Price</div>
      </div>
      {options.map((o, i) => {
        const bg = (o.background ?? {}) as { rating?: number | null; reviewsCount?: number | null };
        const qq = Math.round((o.qualityScore ?? 0) * 100);
        return (
          <div key={optionId(o)} data-testid="option-row" style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${color.surfaceAlt}`, background: i === 0 ? color.brandTint : color.surface }}>
            <div style={{ width: 34, fontSize: fontSize.md, fontWeight: fontWeight.semibold, fontFamily: font.mono, color: i === 0 ? color.brandStrong : color.ink }}>{i + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold }}>{o.subjectProvider}</span>{i === 0 && <span style={{ fontSize: 10, fontWeight: fontWeight.semibold, color: color.brand, background: color.brandTint, padding: '1px 7px', borderRadius: radius.sm }}>BEST</span>}</div>
              <div style={{ fontSize: fontSize.sm, color: color.subtle, marginTop: 2 }}>{bg.rating != null ? `★ ${bg.rating}${bg.reviewsCount != null ? ` · ${bg.reviewsCount} reviews` : ''}` : 'researching'}</div>
            </div>
            <div style={{ width: 120, fontSize: fontSize.sm, color: color.muted }}>{o.availability ?? '—'}</div>
            <div style={{ width: 80, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
              <div style={{ width: 34, height: 5, borderRadius: 3, background: color.surfaceAlt, overflow: 'hidden' }}><div style={{ width: `${qq}%`, height: '100%', background: color.brand }} /></div>
              <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, fontFamily: font.mono }}>{qq}</span>
            </div>
            <div style={{ width: 74, textAlign: 'right', fontSize: fontSize.lg, fontWeight: fontWeight.semibold }}>{o.price != null ? o.price : '—'}</div>
          </div>
        );
      })}
      {streaming && <div style={{ padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${color.line}`, borderTopColor: color.subtle, animation: 'inqi-spin .8s linear infinite' }} /><div style={{ flex: 1 }}><Skeleton width="38%" /></div></div>}
    </div>
  );
}

function StreamingCard() {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.surfaceAlt}`, borderRadius: radius.lg, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 30, flex: 'none' }}><Skeleton width={30} /></div>
      <div style={{ flex: 1 }}><Skeleton width="42%" /><div style={{ height: 8 }} /><Skeleton width="66%" /></div>
      <span style={{ fontSize: fontSize.sm, color: color.subtle }}>qualifying more providers…</span>
    </div>
  );
}

const LABEL: Record<string, (d: Record<string, unknown>) => string> = {
  [EventType.InquiryTransitioned]: (d) => `→ ${d.to}`,
  [EventType.AgentProgress]: (d) => String(d.message ?? d.stage ?? 'working…'),
  [EventType.WaveReleased]: (d) => `released wave ${d.wave} (${d.count} providers)`,
  [EventType.FunnelWidened]: (d) => `widened the search (+${d.added})`,
  [EventType.MessageSent]: () => 'emailed a provider',
  [EventType.MessageReceived]: () => 'reply received',
  [EventType.SubtaskUpdated]: (d) => `provider ${d.status}`,
  [EventType.ReportReady]: (d) => `report ready — ${d.options ?? ''} options`,
};
const eventLabel = (t: TimelineItem) => (LABEL[t.type] ?? (() => t.type))(t.data);
const visibleEvents = (report: ReportState) => report.timeline.filter((t) => t.type !== EventType.AgentHeartbeat).slice(-40).reverse();

/** Layout-A expandable agent activity — the collapsed header shows the latest step. */
function AgentActivity({ report, open, onToggle }: { report: ReportState; open: boolean; onToggle: () => void }) {
  const rows = visibleEvents(report);
  const latest = rows[0];
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, marginBottom: 14, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: report.delivered ? color.brand : color.info, animation: report.delivered ? undefined : 'inqi-pulse 1.3s ease-in-out infinite' }} />
        <span style={{ fontSize: fontSize.base, fontWeight: fontWeight.semibold, flex: 'none' }}>Agent activity</span>
        <span style={{ fontSize: fontSize.base, color: color.muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{latest ? eventLabel(latest) : 'waiting…'}</span>
        <span style={{ fontSize: fontSize.xs, color: color.subtle, fontFamily: font.mono, flex: 'none' }}>{rows.length} steps</span>
        <span style={{ fontSize: 10, color: color.subtle, flex: 'none', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
      </button>
      {open && (
        <div style={{ padding: '6px 16px 14px', borderTop: `1px solid ${color.surfaceSunken}` }}>
          {rows.map((t) => (
            <div key={t.id} style={{ display: 'flex', gap: 11, padding: '7px 0', fontSize: fontSize.base, color: color.inkSoft }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', flex: 'none', background: color.subtle }} />
              <span style={{ lineHeight: 1.45 }}>{eventLabel(t)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TimelineList({ report }: { report: ReportState }) {
  const rows = visibleEvents(report);
  if (rows.length === 0) return <div style={{ color: color.subtle, fontSize: fontSize.sm, paddingBottom: 12 }}>No activity yet…</div>;
  return (
    <div>
      {rows.map((t) => (
        <div key={t.id} style={{ display: 'flex', gap: 11, paddingBottom: 18 }}>
          <span style={{ width: 16, height: 16, borderRadius: '50%', flex: 'none', background: color.subtle }} />
          <div style={{ fontSize: fontSize.base, color: color.inkSoft, lineHeight: 1.4 }}>{eventLabel(t)}</div>
        </div>
      ))}
    </div>
  );
}
