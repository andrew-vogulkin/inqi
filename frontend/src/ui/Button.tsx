import { CSSProperties, ReactNode } from 'react';
import { ButtonVariant } from '../conventions/enums';
import { color, radius, space, fontSize, fontWeight } from '../theme/tokens';

// Prototype: the primary CTA is ink (#1c1c1a), not green — green is the brand mark
// + status accents only. Secondary = white + hairline. Danger = red fill.
const VARIANT: Record<ButtonVariant, CSSProperties> = {
  [ButtonVariant.Primary]: { background: color.ink, color: color.onSolid, borderColor: color.ink },
  [ButtonVariant.Secondary]: { background: color.surface, color: color.ink, borderColor: color.line },
  [ButtonVariant.Ghost]: { background: 'transparent', color: color.inkSoft, borderColor: 'transparent' },
  [ButtonVariant.Danger]: { background: color.danger, color: color.onSolid, borderColor: color.danger },
};

export function Button({
  children, onClick, variant = ButtonVariant.Primary, disabled = false, type = 'button', full = false, testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  type?: 'button' | 'submit';
  full?: boolean;
  testId?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      style={{
        ...VARIANT[variant],
        borderWidth: 1, borderStyle: 'solid', borderRadius: radius.md,
        padding: `${space[2]}px ${space[3]}px`,
        fontSize: fontSize.base, fontWeight: fontWeight.medium,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1, width: full ? '100%' : undefined,
        transition: 'background .12s, opacity .12s',
      }}
    >
      {children}
    </button>
  );
}
