import { StatusTone } from '../conventions/enums';
import { toneColors } from './tone';

/** A small status dot in a tone colour (live indicators, list rows). */
export function StatusDot({ tone, pulse = false }: { tone: StatusTone; pulse?: boolean }) {
  const c = toneColors[tone];
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: 9999,
        background: c.fg, boxShadow: pulse ? `0 0 0 3px ${c.bg}` : undefined,
      }}
    />
  );
}
