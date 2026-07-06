import { CSSProperties, useEffect } from 'react';
import { MessageDirection, SourceType } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { Route, hrefFor } from '../conventions/routes';
import { scoreFor, inquiryOutreachVariant, showsChain, outreachNote, historyTone, OUTREACH_VARIANT_TONE, InquiryRecord } from '../conventions/inquiry';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { adminApi } from '../api';
import { SourceDto, ThreadMessageDto } from '../api/types';
import { EmptyState, Skeleton } from '../ui';
import { toneForInquiryStatus, toneColors } from '../ui/tone';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtime } from '../realtime/socket';

const PAGE: CSSProperties = { maxWidth: 720, margin: '0 auto' };
const CARD: CSSProperties = { background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.xl, padding: '20px 22px' };
const SECTION_LABEL: CSSProperties = { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: color.subtle, letterSpacing: '.04em', textTransform: 'uppercase' };
const PANEL: CSSProperties = { background: color.appBg, border: `1px solid ${color.surfaceAlt}`, borderRadius: radius.lg };

/** FE-11 — one inquiry: system score (qualified-only), outreach exam, status history. */
export function InquiryView({ inquiryId }: { inquiryId: string }) {
  const dispatch = useAppDispatch();
  const inquiry = useSelector((s) => s.inquiry);
  const boardRecord = useSelector((s) => s.adminBoard.inquiriesById[inquiryId]);
  const reportId = useSelector((s) => s.adminBoard.reportId);
  const seenCount = Object.keys(inquiry.seen).length;

  useRealtime({ kind: 'admin' });

  // Seed from the board record (FE-11 is opened from the board).
  useEffect(() => {
    if (boardRecord && (inquiry.inquiryId !== inquiryId)) {
      const record: InquiryRecord = { id: boardRecord.id, epicId: boardRecord.epicId, provider: boardRecord.provider, wave: boardRecord.wave, status: boardRecord.status, qualityScore: boardRecord.qualityScore, personaId: boardRecord.personaId };
      dispatch({ type: ActionType.InquiryLoaded, record, at: new Date().toISOString() });
    }
  }, [boardRecord, inquiryId, inquiry.inquiryId, dispatch]);

  // Chain (admin) — refetch when any event for this inquiry arrives (message.*, inquiry.updated).
  useEffect(() => {
    adminApi.thread({ inquiryId }).then((messages) => dispatch({ type: ActionType.InquiryChainLoaded, messages })).catch(() => undefined);
  }, [inquiryId, seenCount, dispatch]);

  const backHref = reportId ? hrefFor({ route: Route.AdminReport, params: { id: reportId } }) : hrefFor({ route: Route.Admin });

  if (inquiry.inquiryId !== inquiryId || inquiry.status !== AsyncStatus.Ready || !inquiry.record) {
    if (!boardRecord) return <div style={{ ...PAGE }}><EmptyState title="Open this from the board" hint="Inquiry details load from the live board." action={<a href={backHref}>‹ Back to board</a>} /></div>;
    return <div style={{ ...PAGE }}><Skeleton width="40%" /><div style={{ height: 12 }} /><Skeleton /></div>;
  }

  const record = inquiry.record;
  const score = scoreFor(record);
  const variant = inquiryOutreachVariant({ status: record.status, chain: inquiry.chain });
  const tone = toneColors[toneForInquiryStatus(record.status)];

  return (
    <div style={{ ...PAGE }} data-testid="inquiry-view">
      <a href={backHref} style={{ fontSize: fontSize.base, color: color.muted, marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 5 }}>‹ Back to board</a>

      {/* header */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11.5, color: color.subtle, fontFamily: font.mono, letterSpacing: '.05em', marginBottom: 9 }}>INQUIRY · SYSTEM VIEW</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
          <div>
            <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 7px' }}>{record.provider}</h1>
            <div style={{ fontSize: fontSize.base, color: color.muted, fontFamily: font.mono }}>{reportId ? `#${reportId.slice(0, 8)} · ` : ''}#{record.id.slice(0, 10)} · wave {record.wave}{record.personaId ? ` · ${record.personaId}` : ''}</div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, padding: '6px 12px', borderRadius: radius.md, flex: 'none', background: tone.bg, color: tone.fg }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone.fg }} />{record.status}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* SYSTEM SCORE */}
        <div style={CARD}>
          <div style={{ ...SECTION_LABEL, marginBottom: 16 }}>System score</div>
          {score ? (
            <div data-testid="score">
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <ScoreBox label="Public feedback score" value={score.feedbackScore} />
                <ScoreBox label="Price score" value={score.priceScore} />
                <ScoreBox label="Blended" value={score.blendedScore} dark />
              </div>
              <div style={{ fontSize: 12.5, color: color.muted }}>
                {score.rank != null ? <>Ranked <b style={{ color: color.ink }}>#{score.rank}</b> in the report · </> : 'Scored in the report · '}
                {reportId && <a href={hrefFor({ route: Route.AdminDossier, params: { id: reportId, ref: record.provider } })} data-testid="dossier-link" style={{ color: color.info, fontWeight: fontWeight.medium }}>view customer research dossier →</a>}
              </div>
            </div>
          ) : (
            <div data-testid="not-scored" style={{ fontSize: fontSize.base, color: color.muted, lineHeight: 1.5 }}>Not scored yet — only qualified inquiries are scored, so no blended score has been computed.</div>
          )}
        </div>

        {/* SOURCES — the inquiry's channel matrix (websearch / rating / email), streamed in live by depth tasks */}
        <div style={CARD}>
          <div style={{ ...SECTION_LABEL, marginBottom: 14 }}>Sources</div>
          <Sources sources={boardRecord?.sources ?? []} />
        </div>

        {/* OUTREACH EXAMINATION */}
        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={SECTION_LABEL}>Outreach examination</span>
            <a href={hrefFor({ route: Route.AdminThread, params: { id: record.id } })} data-testid="thread-link" style={{ marginLeft: 'auto', fontSize: fontSize.sm, color: color.info }}>full thread →</a>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: toneColors[OUTREACH_VARIANT_TONE[variant]].fg, background: toneColors[OUTREACH_VARIANT_TONE[variant]].bg, padding: '3px 10px', borderRadius: radius.sm }}>{variant}</span>
            <span style={{ fontSize: 11, color: color.subtle, fontFamily: font.mono }}>✉ via inqi</span>
          </div>
          {showsChain(variant)
            ? <Chain messages={inquiry.chain ?? []} />
            : <div data-testid="outreach-note" style={{ ...PANEL, display: 'flex', gap: 12, padding: '14px 16px' }}>
                <span style={{ width: 26, height: 26, borderRadius: 7, flex: 'none', background: color.surfaceSunken, color: color.subtle, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.base }}>✉</span>
                <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.5 }}>{outreachNote(variant)}</div>
              </div>}
        </div>

        {/* STATUS HISTORY */}
        <div style={CARD}>
          <div style={{ ...SECTION_LABEL, marginBottom: 16 }}>Status history</div>
          <ol data-testid="history" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {inquiry.history.map((h, i) => {
              const ht = toneColors[historyTone(h.status)];
              const last = i === inquiry.history.length - 1;
              return (
                <li key={i} style={{ display: 'flex', gap: 12, paddingBottom: last ? 0 : 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: ht.fg }} />
                    {!last && <span style={{ width: 2, flex: 1, background: color.surfaceAlt, marginTop: 3 }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
                    <div style={{ fontSize: 13.5, color: color.ink, fontWeight: fontWeight.medium }}>{h.status}</div>
                    <div style={{ fontSize: 11.5, color: color.subtle, marginTop: 2, fontFamily: font.mono }}>{h.at && h.at !== 'now' ? new Date(h.at).toLocaleString() : 'now'}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

const SOURCE_BADGE: Record<string, { label: string; icon: string }> = {
  [SourceType.Websearch]: { label: 'web', icon: '🌐' },
  [SourceType.RatingFeedback]: { label: 'rating', icon: '★' },
  [SourceType.Email]: { label: 'email', icon: '✉' },
  [SourceType.Whatsapp]: { label: 'whatsapp', icon: '💬' },
};

function Sources({ sources }: { sources: SourceDto[] }) {
  if (!sources.length) {
    return <div data-testid="no-sources" style={{ fontSize: fontSize.base, color: color.muted, lineHeight: 1.5 }}>No sources recorded yet — depth research streams them in as it runs.</div>;
  }
  return (
    <ul data-testid="sources" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sources.map((s) => {
        const badge = SOURCE_BADGE[s.type] ?? { label: s.type, icon: '·' };
        return (
          <li key={s.id} data-testid={`source-${badge.label}`} style={{ ...PANEL, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
            <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: color.subtle, fontFamily: font.mono, flex: 'none', minWidth: 64 }}>{badge.icon} {badge.label}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, color: color.ink, fontWeight: fontWeight.medium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.url?.startsWith('http')
                  ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: color.info }}>{s.title || s.url}</a>
                  : (s.title || (s.type === SourceType.Email ? 'Email thread' : s.url || s.type))}
              </div>
              {s.snippet && <div style={{ fontSize: 11.5, color: color.muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.snippet}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ScoreBox({ label, value, dark }: { label: string; value: number; dark?: boolean }) {
  return (
    <div style={{ flex: 1, background: dark ? color.ink : color.appBg, border: `1px solid ${dark ? color.ink : color.surfaceAlt}`, borderRadius: radius.lg, padding: '14px 16px' }}>
      <div style={{ fontSize: 11.5, color: color.subtle, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: fontSize.h2, fontWeight: fontWeight.semibold, fontFamily: font.mono, color: dark ? color.onSolid : color.ink }}>{Math.round(value * 100)}</div>
    </div>
  );
}

function Chain({ messages }: { messages: ThreadMessageDto[] }) {
  if (!messages.length) return <div style={{ color: color.subtle, fontSize: fontSize.sm }}>Loading thread…</div>;
  return (
    <div data-testid="chain" style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 13, padding: 16 }}>
      {messages.map((m) => {
        const out = m.direction === MessageDirection.Outbound;
        return (
          <div key={m.id} style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
            <div style={{ maxWidth: '80%' }}>
              <div style={{ fontSize: 11, color: color.subtle, marginBottom: 4, textAlign: out ? 'right' : 'left', fontFamily: font.mono }}>{m.direction} · {m.status}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, padding: '11px 14px', borderRadius: radius.lg, background: out ? color.ink : color.surface, color: out ? color.onSolid : color.ink, border: `1px solid ${out ? color.ink : color.line}` }}>{m.body}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
