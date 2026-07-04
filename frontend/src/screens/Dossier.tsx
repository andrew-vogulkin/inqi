import { CSSProperties, ReactNode, useEffect } from 'react';
import { MessageDirection } from '@inqi/shared';
import { AsyncStatus, DossierOrigin, ResearchDepth, ResearchMethod, OutreachVariant } from '../conventions/enums';
import { Route, hrefFor } from '../conventions/routes';
import { optionId } from '../conventions/ranking';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { reportsApi, adminApi, ApiError } from '../api';
import { ErrorState, Skeleton } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { DossierVM, WebSource, FeedbackVM, OutreachVM, ScoringVM } from '../conventions/dossier';
import { ChainMessage } from '../state/dossier.reducer';

const PAGE: CSSProperties = { maxWidth: 720, margin: '0 auto' };
const CARD: CSSProperties = { background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.xl, padding: '20px 22px' };
const PANEL: CSSProperties = { background: color.appBg, border: `1px solid ${color.surfaceAlt}`, borderRadius: radius.md };

const DEPTH_LABEL: Record<ResearchDepth, string> = {
  [ResearchDepth.WebOnly]: 'Web only',
  [ResearchDepth.WebFeedback]: 'Web + feedback',
  [ResearchDepth.WebOutreachFeedback]: 'Web + outreach + feedback',
};
const METHOD: Record<ResearchMethod, { label: string; icon: string; bg: string; fg: string }> = {
  [ResearchMethod.WebSearch]: { label: 'Web search', icon: '⌕', bg: color.surfaceSunken, fg: color.muted },
  [ResearchMethod.Outreach]: { label: 'Outreach', icon: '✉', bg: color.infoTint, fg: color.info },
  [ResearchMethod.FeedbackScan]: { label: 'Feedback scan', icon: '★', bg: color.brandTint, fg: color.brandStrong },
};

/** FE-08 — provenance for one option. Customer = redacted outreach; admin = full chain. */
export function Dossier({ reportId, optionRef, origin }: { reportId: string; optionRef: string; origin: DossierOrigin }) {
  const dispatch = useAppDispatch();
  const d = useSelector((s) => s.dossier);

  useEffect(() => {
    reportsApi.reportLive({ id: reportId })
      .then((live) => {
        const idx = (live.options ?? []).findIndex((o) => optionId(o) === optionRef);
        if (idx < 0) { dispatch({ type: ActionType.DossierLoadFailed, message: 'That option is no longer in the report.' }); return; }
        const option = live.options[idx];
        dispatch({ type: ActionType.DossierLoaded, option, rank: idx + 1, origin });
        if (origin === DossierOrigin.Admin && option.inquiryId) {
          // Admin: the full email chain (admin-gated). Customers never call this.
          adminApi.thread({ inquiryId: option.inquiryId }).then((t) => dispatch({ type: ActionType.DossierChainLoaded, messages: t })).catch(() => undefined);
        } else if (origin === DossierOrigin.Customer) {
          // HP-20: the customer-safe, redacted provenance (no chain) — overlays the VM.
          reportsApi.provenance({ reportId, ref: optionRef }).then((p) => dispatch({ type: ActionType.DossierProvenanceLoaded, provenance: p })).catch(() => undefined);
        }
      })
      .catch((e) => dispatch({ type: ActionType.DossierLoadFailed, message: e instanceof ApiError ? e.message : 'Could not load the dossier.' }));
  }, [reportId, optionRef, origin, dispatch]);

  const adminBack = origin === DossierOrigin.Admin;
  const backHref = adminBack ? hrefFor({ route: Route.Admin }) : hrefFor({ route: Route.Report, params: { id: reportId } });
  const backLabel = adminBack ? '‹ Back to board' : '‹ Back to report';

  if (d.status === AsyncStatus.Error) return <div style={{ ...PAGE }}><ErrorState title="Can't open this dossier" message={d.error ?? undefined} action={<a href={backHref}>{backLabel}</a>} /></div>;
  if (d.status !== AsyncStatus.Ready || !d.dossier) return <div style={{ ...PAGE }}><Skeleton width="40%" /><div style={{ height: 12 }} /><Skeleton /><div style={{ height: 8 }} /><Skeleton width="70%" /></div>;

  const vm = d.dossier;
  return (
    <div style={{ ...PAGE }} data-testid="dossier">
      <a href={backHref} style={{ fontSize: fontSize.base, color: color.muted, marginBottom: space[4], display: 'inline-flex', alignItems: 'center', gap: 5 }}>{backLabel}</a>

      <Header vm={vm} reportId={reportId} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Step n={1} title="Web search" result={vm.researchPending ? 'research in progress' : `${vm.web.length} source${vm.web.length === 1 ? '' : 's'}`} summary={vm.summaries?.web}><WebStep web={vm.web} researchPending={vm.researchPending} /></Step>
        <Step n={2} title="Outreach" result={outreachResult(vm.outreach)} summary={vm.summaries?.outreach}>
          {origin === DossierOrigin.Admin && d.chain ? <AdminChain messages={d.chain} /> : <OutreachStep outreach={vm.outreach} />}
        </Step>
        <Step n={3} title="Feedback scan" result={vm.feedback.reviewsCount != null ? `${vm.feedback.reviewsCount} reviews` : (vm.feedback.rating != null ? `★ ${vm.feedback.rating}` : 'scanned')} summary={vm.summaries?.feedback}>
          <FeedbackStep feedback={vm.feedback} />
        </Step>
        <Step n={4} title="Qualification & ranking" accent result={`ranked #${vm.scoring.rank}`} summary={vm.summaries?.ranking}><ScoringStep scoring={vm.scoring} provider={vm.provider} /></Step>
      </div>
    </div>
  );
}

function Header({ vm, reportId }: { vm: DossierVM; reportId: string }) {
  // Price origin: a reply means the provider quoted it directly; otherwise it came off public listings.
  const priceOrigin = vm.outreach.variant === OutreachVariant.Replied ? 'quoted by provider' : 'from public listings';
  const meta = [vm.price ? `${`${vm.price.amount} ${vm.price.currency}`.trim()} (${priceOrigin})` : null, `ranked #${vm.rank}`].filter(Boolean).join(' · ');
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11.5, color: color.subtle, fontFamily: font.mono, letterSpacing: '.05em', marginBottom: 9 }}>RESEARCH DOSSIER · #{reportId.slice(0, 8)}</div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div>
          <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 7px' }}>{vm.provider}</h1>
          <div style={{ fontSize: fontSize.base, color: color.muted, fontFamily: font.mono }}>{meta}</div>
        </div>
        <span style={{ fontSize: 11.5, fontWeight: fontWeight.semibold, color: color.brandStrong, background: color.brandTint, border: `1px solid #cfe9da`, padding: '6px 12px', borderRadius: radius.md, flex: 'none' }}>{DEPTH_LABEL[vm.depth]}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
        {vm.methods.map((m) => (
          <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: fontWeight.medium, padding: '4px 10px', borderRadius: 7, background: METHOD[m].bg, color: METHOD[m].fg }}>{METHOD[m].icon} {METHOD[m].label}</span>
        ))}
      </div>
    </div>
  );
}

function Step({ n, title, result, accent, summary, children }: { n: number; title: string; result?: string; accent?: boolean; summary?: string; children: ReactNode }) {
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16 }}>
        <span style={{ width: 26, height: 26, borderRadius: radius.sm, background: accent ? color.brand : color.ink, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.sm, fontWeight: fontWeight.semibold, fontFamily: font.mono }}>{n}</span>
        <h3 style={{ fontSize: fontSize.lg, fontWeight: fontWeight.semibold, margin: 0 }}>{title}</h3>
        {result && <span style={{ marginLeft: 'auto', fontSize: fontSize.sm, fontWeight: accent ? fontWeight.medium : fontWeight.regular, color: accent ? color.brand : color.muted }}>{result}</span>}
      </div>
      {summary && <AiSummary text={summary} />}
      {children}
    </div>
  );
}

/** HP-20 transparency: the AI's short rationale for this section (how inqi got here). */
function AiSummary({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, background: color.brandTint, border: `1px solid #cfe9da`, borderRadius: radius.lg, padding: '12px 14px', marginBottom: 14 }}>
      <span style={{ width: 22, height: 22, borderRadius: radius.sm, flex: 'none', background: color.brand, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.sm }}>✦</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: fontWeight.semibold, color: color.brandStrong, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 3 }}>AI summary</div>
        <div style={{ fontSize: 12.5, color: color.inkSoft, lineHeight: 1.5 }}>{text}</div>
      </div>
    </div>
  );
}

function WebStep({ web, researchPending }: { web: WebSource[]; researchPending?: boolean }) {
  const pendingNote = researchPending && (
    <div data-testid="research-pending" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: fontSize.sm, color: color.muted, marginBottom: web.length ? 10 : 0 }}>
      <span style={{ width: 12, height: 12, borderRadius: '50%', flex: 'none', border: `2px solid ${color.lineStrong}`, borderTopColor: color.subtle, animation: 'inqi-spin .9s linear infinite' }} />
      Depth research is still running for this option — web sources and feedback will appear here as they land.
    </div>
  );
  if (web.length === 0) return pendingNote || <div style={{ fontSize: fontSize.sm, color: color.subtle }}>No web sources recorded.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {pendingNote}
      {web.map((w, i) => (
        <div key={i} style={{ ...PANEL, display: 'flex', gap: 12, padding: '12px 14px' }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, flex: 'none', background: color.surfaceSunken, color: color.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.sm }}>⌕</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: fontWeight.semibold }}>{w.source}</span>
              {w.url && <span style={{ fontSize: 11.5, color: color.subtle, fontFamily: font.mono }}>{w.url}</span>}
            </div>
            {w.snippet && <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.5, marginTop: 3 }}>{w.snippet}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

const OUTREACH_COPY: Record<OutreachVariant, string> = {
  [OutreachVariant.Replied]: 'Replied',
  [OutreachVariant.Pending]: 'Awaiting reply',
  [OutreachVariant.NotContacted]: 'Not contacted — from public listings',
};
function outreachResult(o: OutreachVM): string {
  return o.variant === OutreachVariant.Replied ? 'replied' : o.variant === OutreachVariant.Pending ? 'awaiting reply' : 'public listings';
}

/** The outreach conversation as it happened; falls back to the summary card when no chain exists yet. */
function OutreachStep({ outreach }: { outreach: OutreachVM }) {
  if (outreach.chain.length > 0) {
    const pending = outreach.variant === OutreachVariant.Pending;
    return (
      <div data-testid="outreach-chain">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 12.5, color: color.subtle }}>{outreach.persona ? `Reached out as ${outreach.persona}` : 'Reached out on your behalf'}</span>
          <span style={{ fontSize: 10.5, fontWeight: fontWeight.medium, color: color.info, background: color.infoTint, padding: '2px 8px', borderRadius: radius.sm }}>✉ Email</span>
        </div>
        <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 13, padding: 16 }}>
          {outreach.chain.map((m, i) => {
            const out = m.direction === MessageDirection.Outbound;
            return (
              <div key={i} style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '80%' }}>
                  <div style={{ fontSize: 11, color: color.subtle, marginBottom: 4, textAlign: out ? 'right' : 'left', fontFamily: font.mono }}>{out ? outreach.persona ?? 'inqi' : 'provider'}</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5, padding: '11px 14px', borderRadius: radius.lg, whiteSpace: 'pre-wrap', background: out ? color.ink : color.surface, color: out ? color.onSolid : color.ink, border: `1px solid ${out ? color.ink : color.line}` }}>{m.body}</div>
                </div>
              </div>
            );
          })}
          {pending && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: color.muted, fontSize: fontSize.sm }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', flex: 'none', border: `2px solid ${color.lineStrong}`, borderTopColor: color.subtle, animation: 'inqi-spin .9s linear infinite' }} />
              Awaiting the provider&apos;s reply…
            </div>
          )}
        </div>
      </div>
    );
  }
  if (outreach.variant === OutreachVariant.NotContacted) {
    return (
      <div data-testid="outreach-redacted" style={{ ...PANEL, display: 'flex', gap: 12, padding: '14px 16px' }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, flex: 'none', background: color.surfaceSunken, color: color.subtle, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.base }}>—</span>
        <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.5 }}>
          <b style={{ color: color.inkSoft, fontWeight: fontWeight.medium }}>{OUTREACH_COPY[outreach.variant]}.</b> Pricing and availability were read from public listings and reviews — outreach can still be triggered for firsthand confirmation.
        </div>
      </div>
    );
  }
  const pending = outreach.variant === OutreachVariant.Pending;
  return (
    <div data-testid="outreach-redacted">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: color.subtle }}>{outreach.persona ? `Reached out as ${outreach.persona}` : 'Reached out on your behalf'}</span>
        <span style={{ fontSize: 10.5, fontWeight: fontWeight.medium, color: color.info, background: color.infoTint, padding: '2px 8px', borderRadius: radius.sm }}>✉ Email</span>
      </div>
      <div style={{ fontSize: 11, color: color.subtle, marginBottom: 12, fontFamily: font.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{outreach.route}</div>
      <div style={{ ...PANEL, padding: 16, fontSize: 13.5, color: color.inkSoft, lineHeight: 1.5 }}>
        {pending
          ? <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: color.muted, fontSize: fontSize.sm }}><span style={{ width: 12, height: 12, borderRadius: '50%', flex: 'none', border: `2px solid ${color.lineStrong}`, borderTopColor: color.subtle, animation: 'inqi-spin .9s linear infinite' }} /><b style={{ fontWeight: fontWeight.medium }}>{OUTREACH_COPY[outreach.variant]}</b> — pricing taken from the public listing for now.</span>
          : <span><b style={{ fontWeight: fontWeight.medium }}>{OUTREACH_COPY[outreach.variant]}.</b>{outreach.outcome ? ` ${outreach.outcome}` : ' The provider confirmed availability.'}</span>}
      </div>
    </div>
  );
}

/** Admin-only: the full email chain. */
function AdminChain({ messages }: { messages: ChainMessage[] }) {
  return (
    <div data-testid="admin-chain" style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 13, padding: 16 }}>
      {messages.map((m) => {
        const out = m.direction === MessageDirection.Outbound;
        return (
          <div key={m.id} style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
            <div style={{ maxWidth: '80%' }}>
              <div style={{ fontSize: 11, color: color.subtle, marginBottom: 4, textAlign: out ? 'right' : 'left', fontFamily: font.mono }}>{m.direction}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, padding: '11px 14px', borderRadius: radius.lg, background: out ? color.ink : color.surface, color: out ? color.onSolid : color.ink, border: `1px solid ${out ? color.ink : color.line}` }}>{m.body}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FeedbackStep({ feedback }: { feedback: FeedbackVM }) {
  const pos = Math.round(feedback.sentiment * 100);
  const neg = Math.round((1 - feedback.sentiment) * 45);
  const neu = Math.max(0, 100 - pos - neg);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <div style={{ fontSize: 30, fontWeight: fontWeight.semibold, fontFamily: font.mono, letterSpacing: '-.02em' }}>{feedback.rating != null ? feedback.rating : '—'}<span style={{ fontSize: fontSize.lg, color: color.brand }}>★</span></div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', height: 8, borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ width: `${pos}%`, background: color.brand }} />
            <div style={{ width: `${neu}%`, background: color.lineStrong }} />
            <div style={{ width: `${neg}%`, background: '#d99a6c' }} />
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 7, fontSize: 11.5, color: color.muted }}>
            <span>● {pos}% positive</span><span style={{ color: color.subtle }}>● {neu}% neutral</span><span style={{ color: '#b8763f' }}>● {neg}% critical</span>
          </div>
        </div>
      </div>
      {feedback.reviewsCount != null && <div style={{ fontSize: 11.5, color: color.subtle, margin: '14px 0 8px' }}>From {feedback.reviewsCount} public reviews{feedback.eligibility ? ` · ${feedback.eligibility}` : ''}</div>}
      {feedback.themes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: feedback.quotes.length ? 16 : 0 }}>
          {feedback.themes.map((t) => <span key={t} style={{ fontSize: fontSize.sm, color: color.brandStrong, background: color.brandTint, padding: '4px 10px', borderRadius: 7 }}>+ {t}</span>)}
        </div>
      )}
      {feedback.quotes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {feedback.quotes.map((q, i) => (
            <div key={i} style={{ borderLeft: `2px solid ${color.line}`, padding: '2px 0 2px 13px' }}>
              <div style={{ fontSize: fontSize.base, color: color.inkSoft, lineHeight: 1.5, fontStyle: 'italic' }}>"{q}"</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoringStep({ scoring, provider }: { scoring: ScoringVM; provider: string }) {
  const box = (label: string, value: number, dark?: boolean) => (
    <div style={{ flex: 1, background: dark ? color.ink : color.appBg, border: `1px solid ${dark ? color.ink : color.surfaceAlt}`, borderRadius: radius.lg, padding: '14px 16px' }}>
      <div style={{ fontSize: 11.5, color: color.subtle, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, fontFamily: font.mono, color: dark ? color.onSolid : color.ink }}>{Math.round(value * 100)}</div>
    </div>
  );
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        {box('Public feedback score', scoring.feedbackScore)}
        {box('Price score', scoring.priceScore)}
        {box('Blended score', scoring.blendedScore, true)}
      </div>
      <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.55 }}>The blended score weights public feedback against price and availability. With these inputs, {provider} ranked #{scoring.rank} for this report.</div>
    </div>
  );
}
