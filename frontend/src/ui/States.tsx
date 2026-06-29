import { ReactNode } from 'react';
import { color, space, fontSize } from '../theme/tokens';

/** Empty state: a calm, centered message + optional action. */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: `${space[10]}px ${space[4]}px`, color: color.muted }}>
      <div style={{ fontSize: fontSize.h3, color: color.inkSoft, marginBottom: space[1] }}>{title}</div>
      {hint && <div style={{ fontSize: fontSize.base }}>{hint}</div>}
      {action && <div style={{ marginTop: space[3] }}>{action}</div>}
    </div>
  );
}

/** Error state: danger-toned message + optional retry. */
export function ErrorState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: `${space[10]}px ${space[4]}px` }}>
      <div style={{ fontSize: fontSize.h3, color: color.danger, marginBottom: space[1] }}>{title}</div>
      {message && <div style={{ fontSize: fontSize.base, color: color.muted }}>{message}</div>}
      {action && <div style={{ marginTop: space[3] }}>{action}</div>}
    </div>
  );
}
