import { CSSProperties, ReactNode } from 'react';
import { color, radius, space, elevation } from '../theme/tokens';

/** Surface card with a hairline border + very soft shadow (flat, editorial). */
export function Card({ children, sunken = false, style, testId }: { children: ReactNode; sunken?: boolean; style?: CSSProperties; testId?: string }) {
  return (
    <div
      data-testid={testId}
      style={{
        background: sunken ? color.surfaceSunken : color.surface,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        padding: space[4],
        boxShadow: sunken ? elevation.none : elevation.sm,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
