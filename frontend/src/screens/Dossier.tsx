import { useEffect } from 'react';
import { MessageDirection } from '@inqi/shared';
import { AsyncStatus, DossierOrigin, ResearchDepth, ResearchMethod, OutreachVariant, StatusTone } from '../conventions/enums';
import { Route, hrefFor } from '../conventions/routes';
import { optionId } from '../conventions/ranking';
import { color, space, fontSize, fontWeight, radius } from '../theme/tokens';
import { inquiriesApi, adminApi, ApiError } from '../api';
import { Card, Badge, MonoRef, Pill, EmptyState, ErrorState, Skeleton } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { DossierVM, WebSource, FeedbackVM, OutreachVM, ScoringVM } from '../conventions/dossier';
import { ChainMessage } from '../state/dossier.reducer';

const DEPTH_LABEL: Record<ResearchDepth, string> = {
  [ResearchDepth.WebOnly]: 'Web only',
  [ResearchDepth.WebFeedback]: 'Web + feedback',
  [ResearchDepth.WebOutreachFeedback]: 'Web + outreach + feedback',
};
const METHOD_LABEL: Record<ResearchMethod, string> = {
  [ResearchMethod.WebSearch]: 'Web search',
  [ResearchMethod.Outreach]: 'Outreach',
  [ResearchMethod.FeedbackScan]: 'Feedback scan',
};

/** FE-08 — provenance for one option. Customer = redacted outreach; admin = full chain. */
export function Dossier({ inquiryId, optionRef, origin }: { inquiryId: string; optionRef: string; origin: DossierOrigin }) {
  const dispatch = useAppDispatch();
  const d = useSelector((s) => s.dossier);

  useEffect(() => {
    inquiriesApi.reportLive({ id: inquiryId })
      .then((live) => {
        const idx = (live.options ?? []).findIndex((o) => optionId(o) === optionRef);
        if (idx < 0) { dispatch({ type: ActionType.DossierLoadFailed, message: 'That option is no longer in the report.' }); return; }
        const option = live.options[idx];
        dispatch({ type: ActionType.DossierLoaded, option, rank: idx + 1, origin });
        if (origin === DossierOrigin.Admin && option.subtaskId) {
          // Admin: the full email chain (admin-gated). Customers never call this.
          adminApi.thread({ subtaskId: option.subtaskId }).then((t) => dispatch({ type: ActionType.DossierChainLoaded, messages: t })).catch(() => undefined);
        } else if (origin === DossierOrigin.Customer) {
          // HP-20: the customer-safe, redacted provenance (no chain) — overlays the VM.
          inquiriesApi.provenance({ inquiryId, ref: optionRef }).then((p) => dispatch({ type: ActionType.DossierProvenanceLoaded, provenance: p })).catch(() => undefined);
        }
      })
      .catch((e) => dispatch({ type: ActionType.DossierLoadFailed, message: e instanceof ApiError ? e.message : 'Could not load the dossier.' }));
  }, [inquiryId, optionRef, origin, dispatch]);

  const backHref = origin === DossierOrigin.Admin ? hrefFor({ route: Route.Admin }) : hrefFor({ route: Route.Inquiry, params: { id: inquiryId } });

  if (d.status === AsyncStatus.Error) return <ErrorState title="Can't open this dossier" message={d.error ?? undefined} action={<a href={backHref}>← Back</a>} />;
  if (d.status !== AsyncStatus.Ready || !d.dossier) return <Card><div style={{ display: 'grid', gap: space[2] }}><Skeleton width="40%" /><Skeleton /></div></Card>;

  const vm = d.dossier;
  return (
    <div style={{ display: 'grid', gap: space[4] }} data-testid="dossier">
      <a href={backHref} style={{ fontSize: fontSize.sm }}>← Back to {origin === DossierOrigin.Admin ? 'board' : 'report'}</a>

      <Header vm={vm} />
      <Step n={1} title="Web search"><WebStep web={vm.web} /></Step>
      <Step n={2} title="Outreach">
        {origin === DossierOrigin.Admin && d.chain
          ? <AdminChain messages={d.chain} />
          : <OutreachStep outreach={vm.outreach} />}
      </Step>
      <Step n={3} title="Feedback scan"><FeedbackStep feedback={vm.feedback} /></Step>
      <Step n={4} title="Qualification & ranking"><ScoringStep scoring={vm.scoring} /></Step>
    </div>
  );
}

function Header({ vm }: { vm: DossierVM }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space[2] }}>
        <span style={{ color: color.subtle, fontWeight: fontWeight.semibold }}>#{vm.rank}</span>
        <h1 style={{ fontSize: fontSize.h2, flex: 1 }}>{vm.provider}</h1>
        {vm.price && <b>{vm.price.amount} {vm.price.currency}</b>}
      </div>
      <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', marginTop: space[2], alignItems: 'center' }}>
        <Badge tone={StatusTone.Brand}>{DEPTH_LABEL[vm.depth]}</Badge>
        {vm.methods.map((m) => <Pill key={m}>{METHOD_LABEL[m]}</Pill>)}
        <span style={{ color: color.muted, fontSize: fontSize.sm }}>feedback {Math.round(vm.qualityScore * 100)}%</span>
      </div>
    </Card>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[2] }}>
        <span style={{ width: 22, height: 22, borderRadius: radius.pill, background: color.brandTint, color: color.brandStrong, display: 'grid', placeItems: 'center', fontSize: fontSize.xs, fontWeight: fontWeight.bold }}>{n}</span>
        <h3 style={{ fontSize: fontSize.h3 }}>{title}</h3>
      </div>
      {children}
    </Card>
  );
}

function WebStep({ web }: { web: WebSource[] }) {
  if (web.length === 0) return <EmptyState title="No web sources" />;
  return (
    <ul style={{ margin: 0, paddingLeft: space[4], display: 'grid', gap: space[2] }}>
      {web.map((w, i) => (
        <li key={i} style={{ fontSize: fontSize.sm }}>
          <MonoRef>{w.source}</MonoRef>
          {w.snippet && <div style={{ color: color.muted }}>{w.snippet}</div>}
        </li>
      ))}
    </ul>
  );
}

const OUTREACH_COPY: Record<OutreachVariant, string> = {
  [OutreachVariant.Replied]: 'Replied',
  [OutreachVariant.Pending]: 'Awaiting reply',
  [OutreachVariant.NotContacted]: 'Not contacted — from public listings',
};

/** Customer-safe redacted outreach summary (persona + route + outcome) — never the raw chain. */
function OutreachStep({ outreach }: { outreach: OutreachVM }) {
  const tone = outreach.variant === OutreachVariant.Replied ? StatusTone.Brand : outreach.variant === OutreachVariant.Pending ? StatusTone.Warn : StatusTone.Muted;
  return (
    <div style={{ display: 'grid', gap: space[2] }} data-testid="outreach-redacted">
      <div style={{ display: 'flex', gap: space[2], alignItems: 'center' }}>
        <Badge tone={tone}>{OUTREACH_COPY[outreach.variant]}</Badge>
        <MonoRef muted>{outreach.route}</MonoRef>
      </div>
      {outreach.variant === OutreachVariant.Replied && outreach.outcome && <div style={{ fontSize: fontSize.sm, color: color.muted }}>Outcome: {outreach.outcome}</div>}
      {outreach.variant === OutreachVariant.Pending && <div style={{ fontSize: fontSize.sm, color: color.muted }}>We've reached out and are awaiting a reply.</div>}
    </div>
  );
}

/** Admin-only: the full email chain. */
function AdminChain({ messages }: { messages: ChainMessage[] }) {
  return (
    <div style={{ display: 'grid', gap: space[2] }} data-testid="admin-chain">
      {messages.map((m) => (
        <div key={m.id} style={{ borderLeft: `3px solid ${m.direction === MessageDirection.Outbound ? color.info : color.brand}`, paddingLeft: space[3] }}>
          <MonoRef muted>{m.direction}</MonoRef>
          <div style={{ fontSize: fontSize.sm }}>{m.body}</div>
        </div>
      ))}
    </div>
  );
}

function FeedbackStep({ feedback }: { feedback: FeedbackVM }) {
  return (
    <div style={{ display: 'grid', gap: space[2] }}>
      <div style={{ fontSize: fontSize.sm }}>
        {feedback.rating != null ? `★ ${feedback.rating}` : 'No rating'} {feedback.reviewsCount != null && <span style={{ color: color.muted }}>· {feedback.reviewsCount} reviews</span>}
        {feedback.eligibility && <span style={{ color: color.muted }}> · {feedback.eligibility}</span>}
      </div>
      <div>
        <div style={{ fontSize: fontSize.xs, color: color.muted, marginBottom: 2 }}>sentiment</div>
        <div style={{ height: 6, background: color.surfaceSunken, borderRadius: radius.pill }}>
          <div style={{ width: `${Math.round(feedback.sentiment * 100)}%`, height: 6, background: color.brand, borderRadius: radius.pill }} />
        </div>
      </div>
      {feedback.themes.length > 0 && <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>{feedback.themes.map((t) => <Pill key={t}>{t}</Pill>)}</div>}
    </div>
  );
}

function ScoringStep({ scoring }: { scoring: ScoringVM }) {
  const row = (label: string, v: number) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: space[2], fontSize: fontSize.sm }}>
      <span style={{ width: 90, color: color.muted }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: color.surfaceSunken, borderRadius: radius.pill }}>
        <div style={{ width: `${Math.round(v * 100)}%`, height: 6, background: color.brand, borderRadius: radius.pill }} />
      </div>
      <span style={{ width: 40, textAlign: 'right' }}>{Math.round(v * 100)}%</span>
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: space[2] }}>
      {row('Feedback', scoring.feedbackScore)}
      {row('Price', scoring.priceScore)}
      {row('Blended', scoring.blendedScore)}
      <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold }}>Final rank: #{scoring.rank}</div>
    </div>
  );
}
