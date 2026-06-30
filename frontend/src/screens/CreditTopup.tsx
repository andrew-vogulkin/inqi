import { color, space, fontSize, fontWeight, radius } from '../theme/tokens';

/**
 * FE-16 — operator credit top-up. The full customer-search + grant tool lands with
 * the HP-22 admin-customers endpoint; this is the navigable shell so the sidebar
 * route resolves to a real screen rather than a dead link.
 */
export function CreditTopup() {
  return (
    <div data-testid="credit-topup" style={{ maxWidth: 680 }}>
      <h1 style={{ fontSize: 21, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 4px' }}>Credit top-up</h1>
      <p style={{ fontSize: fontSize.base, color: color.muted, margin: '0 0 18px' }}>Grant credits to a customer account while inqi is in early access.</p>

      <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.xl, padding: '22px 24px' }}>
        <label style={{ display: 'block', fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: color.subtle, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 10 }}>Find a customer</label>
        <input disabled placeholder="Search by email…"
          style={{ width: '100%', height: 40, padding: '0 14px', borderRadius: radius.md, border: `1px solid ${color.line}`, background: color.surfaceSunken, fontSize: fontSize.base, color: color.subtle }} />
        <div style={{ marginTop: 16, padding: '14px 16px', background: color.appBg, border: `1px solid ${color.surfaceAlt}`, borderRadius: radius.lg, display: 'flex', gap: 12 }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, flex: 'none', background: color.infoTint, color: color.info, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.base }}>ℹ</span>
          <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.5 }}>
            Customer search + grant wires up with the admin-customers endpoint (HP-22 / FE-16). Until then, grant credits directly via the ledger.
          </div>
        </div>
      </div>
    </div>
  );
}
