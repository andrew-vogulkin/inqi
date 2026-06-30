import { useEffect, useState } from 'react';
import { AsyncStatus } from '../conventions/enums';
import { Route, navigate, hrefFor } from '../conventions/routes';
import { SUGGESTION_TAGS } from '../conventions/suggestions';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { inquiriesApi, creditsApi, ApiError, ApiErrorCode } from '../api';
import { toneColors } from '../ui/tone';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';

/** FE-04 — free-text request capture, credit-gated (reserve 1 credit; 402 → add-credits banner). */
export function NewInquiry() {
  const dispatch = useAppDispatch();
  const credits = useSelector((s) => s.credits);
  const [request, setRequest] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [insufficient, setInsufficient] = useState(false);

  useEffect(() => {
    creditsApi.mine().then((c) => dispatch({ type: ActionType.CreditsLoaded, balance: c.balance, history: c.history })).catch(() => undefined);
  }, [dispatch]);

  const ready = credits.status === AsyncStatus.Ready;
  const outOfCredits = ready && credits.balance <= 0;
  const show402 = insufficient || outOfCredits;
  const canSubmit = request.trim().length > 0 && !submitting && !outOfCredits;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setInsufficient(false);
    try {
      const inq = await inquiriesApi.create({ rawRequest: request.trim() });
      // 201 → the owner live view streams progress (the questionnaire arrives via the pipeline).
      navigate({ route: Route.Inquiry, params: { id: inq.id } });
    } catch (e) {
      if (e instanceof ApiError && e.code === ApiErrorCode.CreditsInsufficient) setInsufficient(true);
      setSubmitting(false);
    }
  }

  return (
    <div data-testid="new-inquiry">
      <a href={hrefFor({ route: Route.Dashboard })} style={{ fontSize: fontSize.base, color: color.muted, marginBottom: space[4], display: 'inline-flex', alignItems: 'center', gap: 5 }}>‹ Dashboard</a>
      <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: `0 0 ${space[2]}px` }}>What should inqi find?</h1>
      <p style={{ fontSize: fontSize.md, color: color.muted, margin: `0 0 ${space[6]}px`, lineHeight: 1.55 }}>Describe it like you&apos;d tell a capable assistant. You can refine the scope in the next step.</p>

      {show402 && (
        <div data-testid="credits-banner" style={{ background: color.surface, border: `1px solid ${color.warnTint}`, borderRadius: radius.lg, padding: `18px 20px`, marginBottom: space[4], display: 'flex', gap: space[3], alignItems: 'flex-start' }}>
          <div style={{ width: 32, height: 32, borderRadius: radius.md, background: color.warnTint, color: color.warn, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.h3, flex: 'none' }}>!</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold, marginBottom: 3 }}>You&apos;re out of credits</div>
            <div style={{ fontSize: fontSize.base, color: color.muted, lineHeight: 1.5, marginBottom: space[3] }}>Each inquiry reserves one credit while agents research. Top up to keep going — your balance is refunded if an inquiry is cancelled before delivery.</div>
            <a href={hrefFor({ route: Route.Credits })} style={{ display: 'inline-flex', height: 34, padding: `0 14px`, alignItems: 'center', borderRadius: radius.md, background: color.ink, color: color.onSolid, fontSize: fontSize.base, fontWeight: fontWeight.medium, textDecoration: 'none' }}>Add credits</a>
          </div>
        </div>
      )}

      <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: 6 }}>
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="e.g. Reformer pilates classes near Shoreditch, evenings, under £30 a session…"
          style={{ width: '100%', minHeight: 120, border: 'none', outline: 'none', resize: 'none', fontFamily: font.ui, fontSize: fontSize.lg, lineHeight: 1.55, padding: `14px 14px 8px`, color: color.ink, background: 'transparent', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, padding: `6px 12px 12px` }}>
          {SUGGESTION_TAGS.map((t) => {
            const c = toneColors[t.tone];
            return (
              <span key={t.tag} style={{ fontSize: fontSize.sm, display: 'inline-flex', alignItems: 'center', gap: 5, color: c.fg, background: c.bg, border: `1px dashed ${c.border}`, padding: `5px 10px`, borderRadius: radius.sm, opacity: t.soon ? 0.7 : 1 }}>
                {t.label}
                {t.soon && <span style={{ fontSize: 9.5, fontWeight: fontWeight.semibold, letterSpacing: '.04em', color: color.subtle, background: color.surface, padding: `1px 5px`, borderRadius: 4 }}>SOON</span>}
              </span>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: space[4] }}>
        <div style={{ fontSize: fontSize.sm, color: color.subtle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color.brand }} />
          Reserves 1 credit · {ready ? credits.balance : '…'} available
        </div>
        <button onClick={submit} disabled={!canSubmit} data-testid="start-research"
          style={{ height: 42, padding: `0 20px`, borderRadius: radius.md, background: color.ink, color: color.onSolid, border: 'none', fontFamily: font.ui, fontSize: fontSize.md, fontWeight: fontWeight.medium, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.55 }}>
          {submitting ? 'Starting…' : 'Start research →'}
        </button>
      </div>
    </div>
  );
}
