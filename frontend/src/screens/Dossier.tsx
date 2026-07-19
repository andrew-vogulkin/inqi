import { CSSProperties, ReactNode, useEffect, useState } from 'react';
import { MessageDirection } from '@inqi/shared';
import { AsyncStatus, DossierOrigin, ResearchDepth, ResearchMethod, OutreachVariant } from '../conventions/enums';
import { Route, hrefFor } from '../conventions/routes';
import { optionId } from '../conventions/ranking';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { reportsApi, adminApi, ApiError } from '../api';
import { ErrorState, Skeleton } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { DossierVM, WebSource, FeedbackVM, OutreachVM, ScoringVM, ChainMessageVM, groupExchanges, groupByChannel, splitCitations, citedSections, CITATION_SECTIONS } from '../conventions/dossier';
import { ChainMessage } from '../state/dossier.reducer';

const PAGE: CSSProperties = { maxWidth: 720, margin: '0 auto' };
const CARD: CSSProperties = { background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.xl, padding: '20px 22px' };
const PANEL: CSSProperties = { background: color.appBg, border: `1px solid ${color.surfaceAlt}`, borderRadius: radius.md };
/** Border for the warn-tinted constraints panel (matches color.warnTint). */
const WARN_BORDER = '#ecd9b0';

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
  // The scope the customer confirmed — step 4 judges constraint mismatches against it.
  const [scope, setScope] = useState<ScopeAnswers>([]);
  const [reportRef, setReportRef] = useState<string | null>(null);

  useEffect(() => {
    reportsApi.reportLive({ id: reportId })
      .then((live) => {
        const idx = (live.options ?? []).findIndex((o) => optionId(o) === optionRef);
        // Not a ranked option → maybe a contacted provider that didn't qualify. Its
        // dossier still opens (the provenance overlay resolves by inquiry name) so the
        // customer can evaluate it manually.
        const failed = idx < 0 ? (live.failedInquiries ?? []).find((f) => f.name === optionRef) : undefined;
        if (idx < 0 && !failed) { dispatch({ type: ActionType.DossierLoadFailed, message: 'That option is no longer in the report.' }); return; }
        const option = idx >= 0 ? live.options[idx] : { subjectProvider: optionRef };
        setReportRef(live.ref ?? null);
        const q = live.questionnaire;
        setScope((q?.questions ?? []).filter((qq) => qq.type !== 'confirm' && q?.answers?.[qq.id]).map((qq) => ({ prompt: qq.prompt, answer: q!.answers![qq.id] })));
        dispatch({ type: ActionType.DossierLoaded, option, rank: idx >= 0 ? idx + 1 : 0, origin });
        if (origin === DossierOrigin.Admin && option.inquiryId) {
          // Admin: the full email chain (admin-gated). Customers never call this.
          adminApi.thread({ inquiryId: option.inquiryId }).then((t) => dispatch({ type: ActionType.DossierChainLoaded, messages: t })).catch(() => dispatch({ type: ActionType.DossierProvenanceFailed }));
        } else if (origin === DossierOrigin.Customer) {
          // HP-20: the customer-safe, redacted provenance (no chain) — overlays the VM.
          reportsApi.provenance({ reportId, ref: optionRef }).then((p) => dispatch({ type: ActionType.DossierProvenanceLoaded, provenance: p })).catch(() => dispatch({ type: ActionType.DossierProvenanceFailed }));
        } else {
          dispatch({ type: ActionType.DossierProvenanceFailed }); // nothing to overlay — don't spin forever
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

      <Header vm={vm} reportId={reportId} reportRef={reportRef} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {vm.qualified === false && <DisqualifiedBanner reason={vm.disqualifyReason ?? null} />}
        {vm.summaries?.overview && <OverviewCard text={vm.summaries.overview} />}
        <Step n={1} title="Web search" result={vm.researchPending ? 'research in progress' : `${vm.web.length} source${vm.web.length === 1 ? '' : 's'}`} summary={vm.summaries?.web}><WebStep web={vm.web} researchPending={vm.researchPending} /></Step>
        <Step n={2} title="Outreach" result={d.overlayPending ? 'loading…' : outreachResult(vm.outreach)} summary={d.overlayPending ? undefined : vm.summaries?.outreach}>
          {/* Hold a small stable spinner until the authoritative conversation lands, then unfold it —
              the full thread can be long, and popping it in would throw the reader's scroll. */}
          {d.overlayPending
            ? <SectionPending label="Retrieving the outreach conversation…" />
            : <Reveal>{origin === DossierOrigin.Admin && d.chain ? <AdminChain messages={d.chain} /> : <OutreachStep outreach={vm.outreach} />}</Reveal>}
        </Step>
        <Step n={3} title="Feedback scan" result={vm.feedback.reviewsCount != null ? `${vm.feedback.reviewsCount} reviews` : (vm.feedback.rating != null ? `★ ${vm.feedback.rating}` : 'scanned')} summary={vm.summaries?.feedback}>
          <FeedbackStep feedback={vm.feedback} />
        </Step>
        <Step n={4} title="Qualification & ranking" accent result={vm.scoring.rank > 0 ? `ranked #${vm.scoring.rank}` : 'didn’t qualify'} summary={vm.summaries?.ranking}><ScoringStep scoring={vm.scoring} provider={vm.provider} reservations={vm.reservations} scope={scope} /></Step>
      </div>
    </div>
  );
}

function Header({ vm, reportId, reportRef }: { vm: DossierVM; reportId: string; reportRef: string | null }) {
  // Price origin: a reply means the provider quoted it directly; otherwise it came off public listings.
  const priceOrigin = vm.outreach.variant === OutreachVariant.Replied ? 'quoted by provider' : 'from public listings';
  const meta = [vm.price ? `${`${vm.price.amount} ${vm.price.currency}`.trim()}${vm.price.basis ? ` ${vm.price.basis}` : ''} (${priceOrigin})` : null, vm.rank > 0 ? `ranked #${vm.rank}` : 'not ranked'].filter(Boolean).join(' · ');
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11.5, color: color.subtle, fontFamily: font.mono, letterSpacing: '.05em', marginBottom: 9 }}>RESEARCH DOSSIER · {reportRef ?? `#${reportId.slice(0, 8)}`}</div>
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
      {vm.reference && <ReferenceRow reference={vm.reference} />}
    </div>
  );
}

/**
 * Carry-it-forward links: the provider's own website/socials (from discovery) and
 * their email address when real outbound mail recorded one — so the customer can
 * contact the provider directly without going through inqi. Styled like the AI
 * summary tint block so it reads as a highlighted takeaway, not page chrome.
 */
function ReferenceRow({ reference }: { reference: NonNullable<DossierVM['reference']> }) {
  const socials = reference.socials ?? [];
  if (!reference.website && !socials.length && !reference.contactEmail) return null;
  const linkStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: fontWeight.medium, padding: '4px 10px', borderRadius: 7, background: color.surface, border: `1px solid #cfe9da`, color: color.info, textDecoration: 'none' };
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  return (
    <div data-testid="dossier-reference" style={{ display: 'flex', gap: 10, background: color.brandTint, border: `1px solid #cfe9da`, borderRadius: radius.lg, padding: '12px 14px', marginTop: 14 }}>
      <span style={{ width: 22, height: 22, borderRadius: radius.sm, flex: 'none', background: color.brand, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.sm }}>↗</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: fontWeight.semibold, color: color.brandStrong, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 6 }}>Contact them directly</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {reference.website && <a href={reference.website} target="_blank" rel="noreferrer" style={linkStyle}>🌐 {host(reference.website)}</a>}
          {socials.map((s) => <a key={s} href={s} target="_blank" rel="noreferrer" style={linkStyle}>↗ {host(s)}</a>)}
          {reference.contactEmail && <a href={`mailto:${reference.contactEmail}`} style={linkStyle}>✉ {reference.contactEmail}</a>}
        </div>
      </div>
    </div>
  );
}

/**
 * Animated expansion (grid-rows 0fr → 1fr): late-arriving section content unfolds
 * over half a second instead of slamming the layout — the reader's scroll position
 * degrades gracefully. Disabled under prefers-reduced-motion.
 */
function Reveal({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => { const f = requestAnimationFrame(() => setOpen(true)); return () => cancelAnimationFrame(f); }, []);
  if (reduced) return <>{children}</>;
  return (
    <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows .55s cubic-bezier(.22,.7,.3,1)' }}>
      <div style={{ overflow: 'hidden', minHeight: 0 }}>{children}</div>
    </div>
  );
}

/** Compact in-section spinner: holds the section small + stable while the authoritative data is in flight. */
function SectionPending({ label }: { label: string }) {
  return (
    <div data-testid="section-pending" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '2px 2px 4px', color: color.muted, fontSize: fontSize.sm }}>
      <span style={{ width: 13, height: 13, borderRadius: '50%', flex: 'none', border: `2px solid ${color.lineStrong}`, borderTopColor: color.subtle, animation: 'inqi-spin .9s linear infinite' }} />
      {label}
    </div>
  );
}

function Step({ n, title, result, accent, summary, children }: { n: number; title: string; result?: string; accent?: boolean; summary?: string; children: ReactNode }) {
  return (
    <div id={`dossier-step-${n}`} style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16 }}>
        <span style={{ width: 26, height: 26, borderRadius: radius.sm, background: accent ? color.brand : color.ink, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.sm, fontWeight: fontWeight.semibold, fontFamily: font.mono }}>{n}</span>
        <h3 style={{ fontSize: fontSize.lg, fontWeight: fontWeight.semibold, margin: 0 }}>{title}</h3>
        {result && <span style={{ marginLeft: 'auto', fontSize: fontSize.sm, fontWeight: accent ? fontWeight.medium : fontWeight.regular, color: accent ? color.brand : color.muted }}>{result}</span>}
      </div>
      {/* The AI summary arrives with the provenance overlay — unfold it, don't jump. */}
      {summary && <Reveal><AiSummary text={summary} /></Reveal>}
      {children}
    </div>
  );
}

/** An inline [n] citation in the overview — clicking it scrolls to the numbered section card. */
function Citation({ n }: { n: number }) {
  return (
    <button
      type="button"
      data-testid="overview-citation"
      title={CITATION_SECTIONS[n]}
      onClick={() => document.getElementById(`dossier-step-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 17, height: 17, padding: '0 4px', margin: '0 2px', border: 'none', borderRadius: radius.sm, background: color.brand, color: color.onSolid, fontSize: 10.5, fontWeight: fontWeight.semibold, fontFamily: font.mono, cursor: 'pointer', verticalAlign: 'text-top' }}
    >{n}</button>
  );
}

/**
 * The general summary of the whole evaluation, rendered ABOVE the section cards.
 * Every claim carries an inline [1]-[4] citation linking down to the section that
 * evidences it; the legend below lists the cited sections. Arrives with the
 * provenance overlay (cached server-side — regenerated only when a new reply or
 * re-rank changes the underlying data).
 */
/** Why this provider is unranked — the vet verdict's reason, so the customer can judge for themselves. */
function DisqualifiedBanner({ reason }: { reason: string | null }) {
  return (
    <div data-testid="disqualified-banner" style={{ background: color.warnTint, border: `1px solid ${WARN_BORDER}`, borderRadius: radius.lg, padding: '14px 16px' }}>
      <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, marginBottom: reason ? 7 : 0 }}>Didn’t qualify — requires manual research</div>
      {reason && <div style={{ fontSize: fontSize.sm, color: color.muted, lineHeight: 1.55 }}>{reason}</div>}
    </div>
  );
}

function OverviewCard({ text }: { text: string }) {
  const cited = citedSections(text);
  return (
    <div data-testid="overview-summary" style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12 }}>
        <span style={{ width: 26, height: 26, borderRadius: radius.sm, background: color.brand, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.sm }}>✦</span>
        <h3 style={{ fontSize: fontSize.lg, fontWeight: fontWeight.semibold, margin: 0 }}>Summary</h3>
        <span style={{ marginLeft: 'auto', fontSize: fontSize.sm, color: color.muted }}>how we evaluated this option</span>
      </div>
      <Reveal>
        <div>
          <div style={{ fontSize: 13, color: color.ink, lineHeight: 1.6 }}>
            {splitCitations(text).map((p, i) => ('cite' in p ? <Citation key={i} n={p.cite} /> : <span key={i}>{p.text}</span>))}
          </div>
          {cited.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12, paddingTop: 10, borderTop: `1px solid ${color.surfaceSunken}` }}>
              {cited.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => document.getElementById(`dossier-step-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.appBg, color: color.muted, fontSize: 11, cursor: 'pointer' }}
                >
                  <span style={{ fontFamily: font.mono, fontWeight: fontWeight.semibold, color: color.brandStrong }}>{n}</span> {CITATION_SECTIONS[n]}
                </button>
              ))}
            </div>
          )}
        </div>
      </Reveal>
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

/**
 * One email of the thread, VERBATIM as it went over the wire: From/Subject header
 * + the untouched body. Outbound = our inquiry (persona voice); inbound = the
 * provider's reply.
 */
function EmailMessage({ m, persona }: { m: ChainMessageVM; persona: string | null }) {
  const out = m.direction === MessageDirection.Outbound;
  const when = m.at ? new Date(m.at).toLocaleString() : '';
  return (
    <div data-testid={out ? 'email-outbound' : 'email-inbound'} style={{ background: color.surface, border: `1px solid ${out ? color.lineStrong : color.line}`, borderLeft: `3px solid ${out ? color.ink : color.brand}`, borderRadius: radius.md, overflow: 'hidden' }}>
      <div style={{ padding: '9px 13px', borderBottom: `1px solid ${color.surfaceSunken}`, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 11, color: color.subtle, fontFamily: font.mono, flex: 'none' }}>From:</span>
          <span style={{ fontSize: 12.5, fontWeight: fontWeight.medium, flex: 1, minWidth: 0 }}>{out ? `${persona ?? 'inqi'} · Inqi Tech Service Provider` : 'the provider'}</span>
          {when && <span style={{ fontSize: 10.5, color: color.subtle, fontFamily: font.mono, flex: 'none' }}>{when}</span>}
        </div>
        {m.subject && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 11, color: color.subtle, fontFamily: font.mono, flex: 'none' }}>Subject:</span>
            <span style={{ fontSize: 12.5, color: color.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.subject}</span>
          </div>
        )}
      </div>
      <div style={{ padding: '12px 14px', fontSize: 13, lineHeight: 1.55, color: color.ink, whiteSpace: 'pre-wrap' }}>{m.body}</div>
    </div>
  );
}

/** The outreach conversation as it happened; falls back to the summary card when no chain exists yet. */
function OutreachStep({ outreach }: { outreach: OutreachVM }) {
  if (outreach.chain.length > 0) {
    const pending = outreach.variant === OutreachVariant.Pending;
    const channels = groupByChannel(outreach.chain);
    return (
      <div data-testid="outreach-chain">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 12.5, color: color.subtle }}>{outreach.persona ? `Reached out as ${outreach.persona}` : 'Reached out on your behalf'}</span>
          <span style={{ fontSize: 10.5, fontWeight: fontWeight.medium, color: color.info, background: color.infoTint, padding: '2px 8px', borderRadius: radius.sm }}>✉ Email</span>
          {channels.length > 1 && <span style={{ fontSize: 10.5, color: color.subtle }}>{channels.length} contacts</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {channels.map(({ channel, msgs }) => {
            const exchanges = groupExchanges(msgs);
            return (
              <div key={channel ?? 'default'} data-testid="outreach-channel">
                {(channel || channels.length > 1) && (
                  <div style={{ fontSize: 10.5, fontWeight: fontWeight.semibold, color: color.info, letterSpacing: '.05em', textTransform: 'uppercase', fontFamily: font.mono, marginBottom: 8 }}>
                    ✉ Outreach — {channel ?? 'general'} contact
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {exchanges.map((ex, i) => (
                    <div key={i} data-testid="email-section" style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
                      {exchanges.length > 1 && (
                        <div style={{ fontSize: 10.5, fontWeight: fontWeight.semibold, color: color.subtle, letterSpacing: '.05em', textTransform: 'uppercase', fontFamily: font.mono }}>Email {i + 1} of {exchanges.length}</div>
                      )}
                      {ex.map((m, j) => <EmailMessage key={j} m={m} persona={outreach.persona} />)}
                    </div>
                  ))}
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
          : <span><b style={{ fontWeight: fontWeight.medium }}>{OUTREACH_COPY[outreach.variant]}.</b> {outreach.outcome ? outreach.outcome : 'The reply content is not available here.'}</span>}
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

/** One confirmed questionnaire answer, as shown in the constraints panel. */
export type ScopeAnswers = { prompt: string; answer: string }[];

/** "Eligible with reservations": which confirmed constraints this option missed, next to what the customer asked for. */
function ConstraintsPanel({ provider, reservations, scope }: { provider: string; reservations: string[]; scope: ScopeAnswers }) {
  return (
    <div data-testid="constraints-panel" style={{ background: color.warnTint, border: `1px solid ${WARN_BORDER}`, borderRadius: radius.lg, padding: '13px 15px', marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: fontWeight.semibold, marginBottom: 8 }}>⚠ Ranked lower: {provider} did not evidence all of your confirmed constraints</div>
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {reservations.map((r, i) => <li key={i} style={{ fontSize: 12.5, color: color.inkSoft, lineHeight: 1.5 }}>{r}</li>)}
      </ul>
      {scope.length > 0 && (
        <div style={{ borderTop: `1px solid ${WARN_BORDER}`, paddingTop: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: fontWeight.semibold, color: color.muted, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 6 }}>Your confirmed constraints</div>
          {scope.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '3px 0', fontSize: fontSize.sm }}>
              <span style={{ flex: 1, minWidth: 0, color: color.muted }}>{s.prompt}</span>
              <span style={{ flex: 'none', maxWidth: '50%', fontWeight: fontWeight.medium, textAlign: 'right' }}>{s.answer}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoringStep({ scoring, provider, reservations, scope }: { scoring: ScoringVM; provider: string; reservations: string[]; scope: ScopeAnswers }) {
  const box = (label: string, value: number, dark?: boolean) => (
    <div style={{ flex: 1, background: dark ? color.ink : color.appBg, border: `1px solid ${dark ? color.ink : color.surfaceAlt}`, borderRadius: radius.lg, padding: '14px 16px' }}>
      <div style={{ fontSize: 11.5, color: color.subtle, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, fontFamily: font.mono, color: dark ? color.onSolid : color.ink }}>{Math.round(value * 100)}</div>
    </div>
  );
  return (
    <div>
      {reservations.length > 0 && <ConstraintsPanel provider={provider} reservations={reservations} scope={scope} />}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        {box('Public feedback score', scoring.feedbackScore)}
        {box('Price score', scoring.priceScore)}
        {box('Blended score', scoring.blendedScore, true)}
      </div>
      <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.55 }}>The blended score weights public feedback against price and availability. {scoring.rank > 0 ? `With these inputs, ${provider} ranked #${scoring.rank} for this report.` : `${provider} didn’t qualify, so it isn’t ranked — evaluate the evidence above yourself.`}{reservations.length > 0 ? ' Its unmet constraints above lowered the feedback score.' : ''}</div>
    </div>
  );
}
