import { ReactNode } from 'react';
import { StatusTone } from '../conventions/enums';
import { radius, space, fontSize, fontWeight } from '../theme/tokens';
import { toneColors } from './tone';

/** A tinted, tone-coloured badge. */
export function Badge({ children, tone = StatusTone.Muted }: { children: ReactNode; tone?: StatusTone }) {
  const c = toneColors[tone];
  return (
    <span style={{
      display: 'inline-block', background: c.bg, color: c.fg,
      border: `1px solid ${c.border}`, borderRadius: radius.sm,
      padding: `1px ${space[2]}px`, fontSize: fontSize.xs, fontWeight: fontWeight.semibold,
      lineHeight: '16px', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

/** Status badge: a tone + label (callers pass the tone from the status→tone map). */
export function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  return <Badge tone={tone}>{label}</Badge>;
}
