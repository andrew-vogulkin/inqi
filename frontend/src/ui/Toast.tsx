import { useEffect } from 'react';
import { color, radius, space, fontSize, elevation } from '../theme/tokens';
import { StatusTone, ToastKind } from '../conventions/enums';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType, ToastItem } from '../state/actions';
import { toneColors } from './tone';

const KIND_TONE: Record<ToastKind, StatusTone> = {
  [ToastKind.Info]: StatusTone.Info,
  [ToastKind.Success]: StatusTone.Brand,
  [ToastKind.Warn]: StatusTone.Warn,
  [ToastKind.Danger]: StatusTone.Danger,
};

const AUTODISMISS_MS = 4000;

/** Renders the toast stack from store state and auto-dismisses each item. */
export function ToastHost() {
  const items = useSelector((s) => s.toasts.items);
  return (
    <div style={{ position: 'fixed', right: space[4], bottom: space[4], display: 'grid', gap: space[2], zIndex: 60 }}>
      {items.map((t) => <ToastRow key={t.id} toast={t} />)}
    </div>
  );
}

function ToastRow({ toast }: { toast: ToastItem }) {
  const dispatch = useAppDispatch();
  const c = toneColors[KIND_TONE[toast.kind]];
  useEffect(() => {
    const h = setTimeout(() => dispatch({ type: ActionType.ToastDismissed, id: toast.id }), AUTODISMISS_MS);
    return () => clearTimeout(h);
  }, [toast.id, dispatch]);
  return (
    <div
      onClick={() => dispatch({ type: ActionType.ToastDismissed, id: toast.id })}
      style={{
        background: color.surface, color: color.ink, borderLeft: `3px solid ${c.fg}`,
        border: `1px solid ${color.line}`, borderLeftWidth: 3, borderRadius: radius.md,
        boxShadow: elevation.md, padding: `${space[2]}px ${space[3]}px`, fontSize: fontSize.base,
        minWidth: 220, maxWidth: 360, cursor: 'pointer',
      }}
    >{toast.message}</div>
  );
}
