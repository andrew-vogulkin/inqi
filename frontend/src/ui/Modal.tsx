import { ReactNode } from 'react';
import { ButtonVariant } from '../conventions/enums';
import { color, radius, space, fontSize, elevation } from '../theme/tokens';
import { Button } from './Button';

/** Centered modal over a scrim. `open` gates render; `onClose` fires on scrim click. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose?: () => void; title?: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,18,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space[4], zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, boxShadow: elevation.md, padding: space[4], width: 'min(440px, 100%)' }}
      >
        {title && <h3 style={{ fontSize: fontSize.h3, marginBottom: space[3] }}>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

/**
 * A confirm/cancel dialog built on Modal. `children` render between the message and
 * the buttons (e.g. FE-12's settlement preview). The confirm fires `onConfirm`
 * **only** on the primary button — opening or aborting makes no caller call.
 */
export function ConfirmDialog({
  open, title, message, children, confirmLabel = 'Confirm', onConfirm, onCancel, danger = false, confirmTestId, cancelTestId,
}: { open: boolean; title: string; message?: string; children?: ReactNode; confirmLabel?: string; onConfirm: () => void; onCancel: () => void; danger?: boolean; confirmTestId?: string; cancelTestId?: string }) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      {message && <p style={{ color: color.muted, marginTop: 0 }}>{message}</p>}
      {children}
      <div style={{ display: 'flex', gap: space[2], justifyContent: 'flex-end', marginTop: space[4] }}>
        <Button variant={ButtonVariant.Secondary} onClick={onCancel} testId={cancelTestId}>Cancel</Button>
        <Button variant={danger ? ButtonVariant.Danger : ButtonVariant.Primary} onClick={onConfirm} testId={confirmTestId}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}
