import { CSSProperties, FormEvent, ClipboardEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AuthRole } from '@inqi/shared';
import { AuthState } from '../conventions/enums';
import { Route, navigate, readReturnTo, allowedReturnTo } from '../conventions/routes';
import { OTP_LENGTH, otpDigits, applyDigit, applyBackspace, applyPaste } from '../conventions/otp';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { authApi, ApiError } from '../api';
import { setStoredSession } from '../conventions/session-storage';
import { KnownAccount, forgetAccount, getKnownAccounts, rememberAccount } from '../conventions/known-accounts';
import { SonarMark } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';

/** Prototype input palette: idle vs invalid field border (focus uses the brand green). */
const BORDER_IDLE = '#e3e2de';
const BORDER_INVALID = '#d99a6c';

/** FE-02 — signed-out entry: brand statement + two-step email sign-in (email → MFA code boxes). */
export function SignIn() {
  const dispatch = useAppDispatch();
  const authState = useSelector((s) => s.session.authState);
  const pendingEmail = useSelector((s) => s.session.pendingEmail);
  const error = useSelector((s) => s.session.error);
  const session = useSelector((s) => s.session.session);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);
  // Accounts that signed in on this device before. Passwordless means the browser has no
  // credential to autofill, so we offer them ourselves.
  const [accounts, setAccounts] = useState<KnownAccount[]>(() => getKnownAccounts());
  const [addingNew, setAddingNew] = useState(false);

  const busy = authState === AuthState.SigningIn;
  // The code step shows once step 1 was accepted — including after a wrong-code error.
  const codeStep = pendingEmail !== null && (authState === AuthState.CodeSent || authState === AuthState.Error);
  // Returning user, nothing to type: pick an account (or explicitly choose another).
  const pickerStep = !codeStep && accounts.length > 0 && !addingNew;

  // Redirect off Sign in once the session is COMMITTED to the store — driven by state,
  // not fired imperatively inside verifyCode. If we navigate before the dispatch commits,
  // the guarded destination (e.g. /admin) renders while the store still reads signed-out
  // and the route guard bounces us right back to /signin?returnTo=… (a commit race that
  // bit iOS Safari; desktop happened to win it). HP-24: resume the deep link we were
  // bounced from — but only where THIS role may go (a stale returnTo=/admin from a
  // previous operator session must not 403 a customer) — else the role-aware home.
  useLayoutEffect(() => {
    if (!session) return;
    const isAdmin = session.customer.role === AuthRole.Admin;
    const returnTo = allowedReturnTo({ returnTo: readReturnTo(), isAdmin });
    if (returnTo) window.location.hash = returnTo;
    else navigate({ route: isAdmin ? Route.Admin : Route.Dashboard });
  }, [session]);

  // The async glue (call api → dispatch result → route). No business logic here.
  // Takes the address explicitly: picking a remembered account must send the code to THAT
  // address, without waiting a render for `email` state to settle.
  async function requestCode(addr: string) {
    if (!addr || busy) return;
    dispatch({ type: ActionType.SignInStarted });
    try {
      await authApi.startEmail({ email: addr });
      dispatch({ type: ActionType.CodeSent, email: addr });
      setCode('');
      setResent(false);
    } catch (e) {
      dispatch({ type: ActionType.SignInFailed, message: e instanceof ApiError ? e.message : 'Sign-in failed. Please try again.' });
    }
  }

  async function verifyCode() {
    if (!pendingEmail || code.length !== OTP_LENGTH || busy) return;
    dispatch({ type: ActionType.SignInStarted });
    try {
      const sess = await authApi.verifyEmail({ email: pendingEmail, code });
      // Make the token readable synchronously (the api layer reads it for the Bearer
      // header) and commit the session. Navigation is handled by the redirect effect
      // above — once the store reflects the session — so the guarded destination never
      // renders signed-out and can't bounce back to Sign in.
      setStoredSession(sess);
      // Only a VERIFIED sign-in is remembered — a typo'd address that never got past the
      // code step must not end up on the picker forever.
      rememberAccount({ email: sess.customer.email });
      dispatch({ type: ActionType.SignedIn, session: sess });
    } catch (e) {
      dispatch({ type: ActionType.SignInFailed, message: e instanceof ApiError ? e.message : 'Sign-in failed. Please try again.' });
    }
  }

  async function resendCode() {
    if (!pendingEmail || busy) return;
    try {
      await authApi.startEmail({ email: pendingEmail });
      setResent(true);
      setCode('');
    } catch {
      setResent(false);
    }
  }

  const onEmailSubmit = (e: FormEvent) => { e.preventDefault(); void requestCode(email); };
  const onCodeSubmit = (e: FormEvent) => { e.preventDefault(); void verifyCode(); };

  /** Forget a device-local account. Never signs anyone out; nothing leaves the browser. */
  const onForget = (addr: string) => {
    const next = forgetAccount({ email: addr });
    setAccounts(next);
    if (next.length === 0) setAddingNew(true); // nothing left to pick — go straight to the form
  };

  const buttonStyle = (enabled: boolean): CSSProperties => ({
    width: '100%', height: 52, borderRadius: 11, background: color.ink, color: color.onSolid,
    fontFamily: font.ui, fontSize: fontSize.lg, fontWeight: fontWeight.medium,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.55,
    border: 'none', transition: 'opacity .15s',
  });
  const spinner = (
    <span style={{ width: 17, height: 17, borderRadius: '50%', border: '2px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'inqi-spin .7s linear infinite' }} />
  );

  return (
    <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space[10] }}>
      <div style={{ width: '100%', maxWidth: 392, textAlign: 'center' }}>
        {/* brand mark — the one place green leads. Sonar loader (design Variant B):
            the mark's heartbeat pings, and echo dots light up as the wave reaches them. */}
        <div data-testid="sonar-mark" style={{ display: 'flex', justifyContent: 'center', margin: `0 auto ${space[3]}px` }}>
          <SonarMark size={124} markSize={52} />
        </div>

        {pickerStep ? (
          <>
            <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 9px' }}>Welcome back.</h1>
            <p style={{ fontSize: fontSize.lg, color: color.muted, lineHeight: 1.55, margin: '0 0 28px' }}>
              Choose an account to continue — we&rsquo;ll send a fresh sign-in code.
            </p>
            <div data-testid="account-picker" style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
              {accounts.map((a) => (
                <AccountRow key={a.email} email={a.email} busy={busy} onPick={() => void requestCode(a.email)} onForget={() => onForget(a.email)} />
              ))}
            </div>
            <button
              type="button"
              data-testid="use-another-email"
              onClick={() => { setAddingNew(true); setEmail(''); }}
              style={{
                width: '100%', height: 52, marginTop: 10, borderRadius: 11, background: 'transparent', color: color.ink,
                border: `1.5px solid ${BORDER_IDLE}`, fontFamily: font.ui, fontSize: fontSize.lg, fontWeight: fontWeight.medium,
                cursor: 'pointer',
              }}>
              Use another email
            </button>
          </>
        ) : !codeStep ? (
          <>
            <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 9px' }}>One report. AI agents on it.</h1>
            <p style={{ fontSize: fontSize.lg, color: color.muted, lineHeight: 1.55, margin: '0 0 28px' }}>
              Ask inqi for anything. Agents research and reach out to real providers, then stream back a live, ranked report of your options.
            </p>
            <form onSubmit={onEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
              <EmailField value={email} onChange={setEmail} invalid={authState === AuthState.Error} />
              <button type="submit" disabled={!email || busy} data-testid="signin-button" style={buttonStyle(!!email && !busy)}>
                {busy ? <>{spinner}<span>Sending code…</span></> : <><span>Continue with email</span><span style={{ fontSize: 16 }}>→</span></>}
              </button>
            </form>
            {accounts.length > 0 && (
              <button
                type="button"
                data-testid="back-to-accounts"
                onClick={() => setAddingNew(false)}
                style={{ background: 'none', border: 'none', color: color.muted, fontWeight: fontWeight.medium, cursor: 'pointer', fontFamily: font.ui, fontSize: fontSize.base, marginTop: 18 }}>
                ← Back to saved accounts
              </button>
            )}
          </>
        ) : (
          <>
            <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 9px' }}>Check your inbox</h1>
            <p style={{ fontSize: fontSize.lg, color: color.muted, lineHeight: 1.55, margin: '0 0 28px' }}>
              We sent a 6-digit code to <strong style={{ color: color.ink, fontWeight: fontWeight.medium }}>{pendingEmail}</strong>. Enter it below to continue.
            </p>
            <form onSubmit={onCodeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
              <CodeBoxes code={code} onChange={setCode} invalid={authState === AuthState.Error} />
              <button type="submit" disabled={code.length !== OTP_LENGTH || busy} data-testid="verify-button" style={buttonStyle(code.length === OTP_LENGTH && !busy)}>
                {busy ? <>{spinner}<span>Verifying…</span></> : <span>Verify &amp; continue</span>}
              </button>
            </form>
            {resent && <p data-testid="code-resent" style={{ fontSize: fontSize.sm, color: color.brand, margin: `${space[3]}px 0 0` }}>New code sent.</p>}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, margin: '22px 0 0', fontSize: fontSize.base }}>
              <button type="button" onClick={() => void resendCode()} style={{ background: 'none', border: 'none', color: color.muted, fontWeight: fontWeight.medium, cursor: 'pointer', fontFamily: font.ui, fontSize: fontSize.base }}>Resend code</button>
              <span style={{ color: color.lineStrong }}>·</span>
              <button
                type="button"
                data-testid="change-email"
                onClick={() => { dispatch({ type: ActionType.SignedOut }); setCode(''); setResent(false); }}
                style={{ background: 'none', border: 'none', color: color.muted, fontWeight: fontWeight.medium, cursor: 'pointer', fontFamily: font.ui, fontSize: fontSize.base }}>
                Change email
              </button>
            </div>
          </>
        )}

        {authState === AuthState.Error && error && (
          <p data-testid="signin-error" style={{ color: color.warn, marginTop: space[3], fontSize: fontSize.sm, textAlign: 'left' }}>{error}</p>
        )}

        {!codeStep && !pickerStep && (
          <>
            <p style={{ fontSize: fontSize.sm, color: color.subtle, margin: `${space[5]}px 0 0` }}>New here? We&rsquo;ll create your account automatically — no separate sign-up.</p>
            <p style={{ fontSize: fontSize.sm, color: color.subtle, margin: `${space[2]}px 0 0` }}>First report is free. No card required.</p>
          </>
        )}
        {pickerStep && (
          <p style={{ fontSize: fontSize.sm, color: color.subtle, margin: `${space[5]}px 0 0` }}>
            Saved on this device only — remove any account with ×.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One remembered account: the row itself sends a fresh code to that address; the × forgets
 * it on this device. The × is a real sibling button, not nested inside the row's button —
 * a button inside a button is invalid HTML and the click target becomes ambiguous.
 */
function AccountRow({ email, busy, onPick, onForget }: { email: string; busy: boolean; onPick: () => void; onForget: () => void }) {
  const [hovered, setHovered] = useState(false);
  const initial = email.trim().charAt(0).toUpperCase();
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', height: 60, gap: 12, padding: '0 12px 0 14px',
        border: `1.5px solid ${hovered ? color.brand : BORDER_IDLE}`, borderRadius: 11,
        background: color.surface, transition: 'border-color .15s',
      }}>
      <button
        type="button"
        disabled={busy}
        data-testid={`account-${email}`}
        onClick={onPick}
        style={{
          // minWidth:0 — a flex item defaults to min-width:auto, which refuses to shrink below
          // its content. Without it a long address blows the row open and pushes the × outside
          // the card instead of ellipsing.
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, height: '100%',
          background: 'none', border: 'none', padding: 0, textAlign: 'left',
          cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.55 : 1, fontFamily: font.ui,
        }}>
        <span
          aria-hidden
          style={{
            width: 34, height: 34, flexShrink: 0, borderRadius: '50%', background: color.brand, color: color.onSolid,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: fontSize.base, fontWeight: fontWeight.semibold,
          }}>
          {initial}
        </span>
        {/* The address can be long — never let it push the × off the row. */}
        <span style={{ flex: 1, minWidth: 0, fontSize: fontSize.lg, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {email}
        </span>
        <span aria-hidden style={{ color: color.subtle, fontSize: 16 }}>→</span>
      </button>
      <button
        type="button"
        data-testid={`forget-${email}`}
        aria-label={`Forget ${email} on this device`}
        onClick={onForget}
        style={{
          width: 28, height: 28, flexShrink: 0, borderRadius: 7, border: 'none', background: 'none',
          color: color.subtle, fontSize: fontSize.lg, lineHeight: 1, cursor: 'pointer', fontFamily: font.ui,
        }}>
        ×
      </button>
    </div>
  );
}

/** Step-1 email field: prefix icon + focus ring per the prototype (52px row, warm border on error). */
function EmailField({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid: boolean }) {
  const [focused, setFocused] = useState(false);
  const border = focused ? color.brand : invalid ? BORDER_INVALID : BORDER_IDLE;
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 52, border: `1.5px solid ${border}`, borderRadius: 11, background: color.surface, padding: '0 15px', transition: 'border-color .15s' }}>
      <span aria-hidden style={{ color: color.subtle, fontSize: fontSize.lg, marginRight: 11 }}>✉</span>
      <input
        type="email" name="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"
        value={value} onChange={(e) => onChange(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        placeholder="you@example.com"
        style={{ flex: 1, border: 'none', outline: 'none', fontSize: fontSize.lg, fontFamily: font.ui, background: 'transparent', color: color.ink, height: '100%' }}
      />
    </div>
  );
}

/**
 * The 6-box MFA input. All keyboard/paste rules live in `conventions/otp` (pure,
 * unit-tested); this component only renders boxes and moves focus.
 */
function CodeBoxes({ code, onChange, invalid }: { code: string; onChange: (code: string) => void; invalid: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusedAt, setFocusedAt] = useState<number | null>(null);
  const digits = otpDigits(code);

  // Entering the code step: the first box takes focus so typing starts immediately.
  useEffect(() => { refs.current[0]?.focus(); }, []);

  const apply = ({ code: next, focusIndex }: { code: string; focusIndex: number | null }) => {
    onChange(next);
    if (focusIndex != null) {
      // Focus moves SYNCHRONOUSLY — a fast typist's next keystroke must land in the
      // next box; only the select waits for React to paint the new value.
      const el = refs.current[focusIndex];
      el?.focus();
      requestAnimationFrame(() => el?.select());
    }
  };
  const onKey = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') { e.preventDefault(); apply(applyBackspace({ code, index: i })); }
    else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < OTP_LENGTH - 1) refs.current[i + 1]?.focus();
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const edit = applyPaste({ text: e.clipboardData?.getData('text') ?? '' });
    if (edit) { e.preventDefault(); apply(edit); }
  };

  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
      {digits.map((d, i) => {
        const border = focusedAt === i ? color.brand : invalid ? BORDER_INVALID : BORDER_IDLE;
        return (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            type="text" inputMode="numeric" pattern="[0-9]*"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            data-testid={`otp-${i}`}
            aria-label={`Code digit ${i + 1}`}
            value={d}
            onChange={(e) => apply(applyDigit({ code, index: i, raw: e.target.value }))}
            onKeyDown={onKey(i)}
            onFocus={(e) => { setFocusedAt(i); e.currentTarget.select(); }}
            onBlur={() => setFocusedAt((cur) => (cur === i ? null : cur))}
            onPaste={onPaste}
            style={{
              width: 46, height: 58, border: `1.5px solid ${border}`, borderRadius: 11, textAlign: 'center',
              fontFamily: font.mono, fontSize: 26, fontWeight: fontWeight.semibold, color: color.ink,
              background: color.surface, outline: 'none', transition: 'border-color .15s',
            }}
          />
        );
      })}
    </div>
  );
}
