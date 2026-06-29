import { ReactNode } from 'react';
import { font, fontSize, color } from '../theme/tokens';

/** Geist Mono treatment for ids / refs / numbers / email routes / metadata. */
export function MonoRef({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span style={{ fontFamily: font.mono, fontSize: fontSize.sm, color: muted ? color.muted : color.inkSoft }}>
      {children}
    </span>
  );
}
