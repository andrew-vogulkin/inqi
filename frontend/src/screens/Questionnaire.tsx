import { ReactNode, CSSProperties, useEffect, useState } from 'react';
import { AsyncStatus, TokenState, FieldType, fieldTypeFromWire, QuestionnaireField } from '../conventions/enums';
import { Route, navigate, hrefFor } from '../conventions/routes';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { questionnaireApi, inquiriesApi, ApiError, ApiErrorCode } from '../api';
import { QuestionnaireQuestion } from '../api/types';
import { Skeleton } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { canSubmitQuestionnaire, buildSubmitBody, multiSelected, QuestionnaireState } from '../state/questionnaire.reducer';

const PAGE: CSSProperties = { minHeight: '100vh', padding: '48px 28px' };
const COL: CSSProperties = { maxWidth: 640, margin: '0 auto' };
const CARD: CSSProperties = { background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.xl, padding: '22px 24px' };
const inkBtn: CSSProperties = { display: 'inline-flex', height: 40, padding: '0 18px', alignItems: 'center', borderRadius: radius.md, background: color.ink, color: color.onSolid, fontSize: fontSize.md, fontWeight: fontWeight.medium, textDecoration: 'none' };
const labelStyle: CSSProperties = { fontSize: fontSize.base, fontWeight: fontWeight.medium, color: color.inkSoft, marginBottom: 9 };

/** FE-05 — /q/:token (HP-24: owner-gated): pre-research enrichment + data-driven confirm form (prototype-matched). */
export function Questionnaire({ token }: { token: string }) {
  const dispatch = useAppDispatch();
  const q = useSelector((s) => s.questionnaire);
  const [request, setRequest] = useState<string | null>(null);

  useEffect(() => {
    questionnaireApi.get({ token })
      .then((data) => {
        dispatch({ type: ActionType.QuestionnaireLoaded, data, now: Date.now() });
        inquiriesApi.reportLive({ id: data.inquiryId }).then((live) => setRequest(live.rawRequest)).catch(() => undefined);
      })
      .catch((e) => dispatch({ type: ActionType.QuestionnaireLoadFailed, code: e instanceof ApiError ? e.code : ApiErrorCode.QuestionnaireNotFound }));
  }, [token, dispatch]);

  async function submit() {
    const body = buildSubmitBody(q);
    dispatch({ type: ActionType.SubmitStarted });
    try {
      await questionnaireApi.submit({ token, confirmedSubject: body.confirmedSubject, answers: body.answers });
      dispatch({ type: ActionType.SubmitSucceeded });
      if (q.data) navigate({ route: Route.Inquiry, params: { id: q.data.inquiryId } });
    } catch (e) {
      const expired = e instanceof ApiError && e.code === ApiErrorCode.QuestionnaireExpired;
      dispatch({ type: ActionType.SubmitFailed, message: e instanceof ApiError ? e.message : 'Could not submit. Please try again.', expired });
    }
  }

  return (
    <div style={PAGE}>
      <div style={COL}>
        <a href={hrefFor({ route: Route.Dashboard })} style={{ fontSize: fontSize.base, color: color.muted, marginBottom: space[5], display: 'inline-flex', alignItems: 'center', gap: 5 }}>‹ Dashboard</a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: space[8], opacity: 0.85 }}>
          <span style={{ width: 24, height: 24, borderRadius: radius.sm, background: color.brand, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: fontWeight.bold, fontSize: fontSize.base }}>i</span>
          <span style={{ fontSize: fontSize.base, color: color.muted }}>inqi · scope confirmation</span>
          <span style={{ marginLeft: 'auto', fontSize: fontSize.xs, color: color.subtle, fontFamily: font.mono }}>secure link</span>
        </div>

        {(q.status === AsyncStatus.Idle || q.tokenState === TokenState.Loading) && (
          <div style={CARD}><div style={{ display: 'grid', gap: space[2] }}><Skeleton width="40%" /><Skeleton /><Skeleton width="70%" /></div></div>
        )}

        {(q.tokenState === TokenState.NotFound || q.tokenState === TokenState.Expired) && (
          <StatusCard tile="⏱" tone="muted"
            title={q.tokenState === TokenState.Expired ? 'This link has expired' : "This link isn't valid"}
            body="Scope-confirmation links stay open for 72 hours. Ask for a fresh link, or sign in to pick up where you left off.">
            <a href={hrefFor({ route: Route.SignIn })} style={inkBtn}>Go to sign in</a>
          </StatusCard>
        )}

        {q.tokenState === TokenState.Submitted && (
          <StatusCard tile="✓" tone="brand" title="Scope confirmed — research is underway"
            body="inqi's agents are reaching out to providers now. Your live report opens as options come in.">
            {q.data && <a href={hrefFor({ route: Route.Inquiry, params: { id: q.data.inquiryId } })} style={inkBtn}>Open live report →</a>}
          </StatusCard>
        )}

        {q.tokenState === TokenState.Open && <OpenForm q={q} request={request} onSubmit={submit} />}
      </div>
    </div>
  );
}

function StatusCard({ tile, tone, title, body, children }: { tile: string; tone: 'brand' | 'muted'; title: string; body: string; children?: ReactNode }) {
  const tint = tone === 'brand' ? color.brandTint : color.surfaceSunken;
  const fg = tone === 'brand' ? color.brand : color.subtle;
  return (
    <div style={{ ...CARD, textAlign: 'center', padding: '40px 32px' }}>
      <div style={{ width: 44, height: 44, borderRadius: radius.lg, background: tint, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: `0 auto ${space[4]}px`, fontSize: fontSize.h2 }}>{tile}</div>
      <h2 style={{ fontSize: fontSize.h2, fontWeight: fontWeight.semibold, margin: `0 0 ${space[2]}px` }}>{title}</h2>
      <p style={{ fontSize: fontSize.md, color: color.muted, lineHeight: 1.55, margin: `0 auto ${space[5]}px`, maxWidth: 400 }}>{body}</p>
      {children}
    </div>
  );
}

function OpenForm({ q, request, onSubmit }: { q: QuestionnaireState; request: string | null; onSubmit: () => void }) {
  const dispatch = useAppDispatch();
  const questions = q.data?.questions ?? [];
  const confirmQ = questions.find((x) => fieldTypeFromWire(x.type) === FieldType.Confirm);
  const fields = questions.filter((x) => fieldTypeFromWire(x.type) !== FieldType.Confirm);
  const canSubmit = canSubmitQuestionnaire(q);
  const greenBorder = `1px solid ${color.brand}33`;

  return (
    <>
      {/* pre-research enrichment */}
      <div style={{ background: color.brandTint, border: greenBorder, borderRadius: radius.xl, padding: '22px 24px', marginBottom: space[3] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
          <span style={{ width: 22, height: 22, borderRadius: radius.sm, background: color.brand, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.sm }}>✦</span>
          <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: color.brandStrong, letterSpacing: '.04em', textTransform: 'uppercase' }}>inqi pre-researched your request</span>
          <span style={{ marginLeft: 'auto', fontSize: fontSize.xs, color: color.brandStrong, background: color.surface, border: greenBorder, padding: '3px 9px', borderRadius: radius.sm }}>no credit yet</span>
        </div>
        {request === null ? <Skeleton width="80%" /> : <div style={{ fontSize: fontSize.h3, fontWeight: fontWeight.medium, lineHeight: 1.5, color: color.ink, letterSpacing: '-.01em', marginBottom: 14 }} data-testid="enriched">{request}</div>}
        <div style={{ fontSize: fontSize.sm, color: color.muted, lineHeight: 1.5 }}>We filled in what we could from a quick research pass. Confirm or adjust the details below — the more precise, the sharper your report.</div>
      </div>

      {/* clarifying details */}
      <div style={{ ...CARD, marginBottom: space[3] }}>
        <div style={{ fontSize: fontSize.lg, fontWeight: fontWeight.semibold, letterSpacing: '-.01em', marginBottom: space[5] }}>A few details to get it right</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[5] }}>
          {fields.map((f) => <Field key={f.id} field={f} value={q.answers[f.id] ?? ''} />)}
        </div>
      </div>

      {/* confirm + submit */}
      <div style={CARD}>
        <div style={{ fontSize: fontSize.base, fontWeight: fontWeight.medium, color: color.inkSoft, marginBottom: 9 }}>Anything else we should know?</div>
        <textarea
          value={q.answers[QuestionnaireField.Notes] ?? ''}
          onChange={(e) => dispatch({ type: ActionType.AnswerChanged, id: QuestionnaireField.Notes, value: e.target.value })}
          placeholder="Optional — e.g. must be wheelchair accessible, prefer a particular instructor…"
          style={{ width: '100%', minHeight: 70, border: `1px solid ${color.line}`, borderRadius: radius.md, outline: 'none', resize: 'none', fontFamily: font.ui, fontSize: fontSize.md, lineHeight: 1.5, padding: 12, color: color.ink, marginBottom: space[5], boxSizing: 'border-box' }}
        />
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: space[5], cursor: 'pointer' }}>
          <input type="checkbox" checked={q.confirmed} onChange={(e) => dispatch({ type: ActionType.ConfirmToggled, value: e.target.checked })} data-testid="confirm-gate" style={{ width: 18, height: 18, marginTop: 1, accentColor: color.brand, flex: 'none' }} />
          <span style={{ fontSize: fontSize.base, color: color.ink, lineHeight: 1.5 }}>{confirmQ?.prompt ?? 'This is right. inqi can begin contacting providers on my behalf.'}</span>
        </label>
        {q.error && <p style={{ color: color.danger, fontSize: fontSize.sm, marginTop: 0 }}>{q.error}</p>}
        <button onClick={onSubmit} disabled={!canSubmit}
          style={{ width: '100%', height: 46, borderRadius: radius.md, background: canSubmit ? color.ink : color.lineStrong, color: color.onSolid, border: 'none', fontFamily: font.ui, fontSize: fontSize.lg, fontWeight: fontWeight.medium, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
          {q.submitting ? 'Starting…' : 'Confirm & start research'}
        </button>
      </div>
    </>
  );
}

/** Data-driven field: the field-type enum picks the control (chips = ink-selected, prototype). */
function Field({ field, value }: { field: QuestionnaireQuestion; value: string }) {
  const dispatch = useAppDispatch();
  const type = fieldTypeFromWire(field.type);
  const options = field.options ?? [];

  const chip = (label: string, selected: boolean, onClick: () => void) => (
    <button key={label} onClick={onClick}
      style={{ fontSize: fontSize.base, padding: '7px 13px', borderRadius: radius.md, fontWeight: fontWeight.medium, cursor: 'pointer', border: `1px solid ${selected ? color.ink : color.lineStrong}`, background: selected ? color.ink : color.surface, color: selected ? color.onSolid : color.inkSoft }}>
      {label}
    </button>
  );

  if (type === FieldType.Select || type === FieldType.MultiSelect) {
    const chosen = type === FieldType.MultiSelect ? multiSelected(value) : [value];
    const onPick = (o: string) => type === FieldType.MultiSelect
      ? dispatch({ type: ActionType.MultiAnswerToggled, id: field.id, option: o })
      : dispatch({ type: ActionType.AnswerChanged, id: field.id, value: o });
    return (
      <div>
        <div style={labelStyle}>{field.prompt}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>{options.map((o) => chip(o, chosen.includes(o), () => onPick(o)))}</div>
      </div>
    );
  }
  return (
    <div>
      <div style={labelStyle}>{field.prompt}</div>
      <input value={value} onChange={(e) => dispatch({ type: ActionType.AnswerChanged, id: field.id, value: e.target.value })} placeholder="Your answer"
        style={{ width: '100%', height: 42, border: `1px solid ${color.line}`, borderRadius: radius.md, outline: 'none', fontFamily: font.ui, fontSize: fontSize.md, padding: '0 13px', color: color.ink, background: color.appBg, boxSizing: 'border-box' }} />
    </div>
  );
}
