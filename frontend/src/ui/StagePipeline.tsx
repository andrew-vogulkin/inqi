import { color, radius, space, fontSize } from '../theme/tokens';
import { STAGE_ORDER } from '../conventions/stages';

/**
 * 6-segment customer pipeline (Draft → Ready). `currentIndex` segments fill brand;
 * the rest are sunken. `failed` paints the current segment danger (a stopped run).
 */
export function StagePipeline({ currentIndex, failed = false }: { currentIndex: number; failed?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGE_ORDER.length}, 1fr)`, gap: space[1] }}>
      {STAGE_ORDER.map((label, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const fill = failed && active ? color.danger : done || active ? color.brand : color.surfaceSunken;
        return (
          <div key={label} title={label} style={{ display: 'grid', gap: 2 }}>
            <div style={{ height: 4, borderRadius: radius.pill, background: fill, opacity: active && !failed ? 0.8 : 1 }} />
            <span style={{ fontSize: fontSize.xs, color: done || active ? color.inkSoft : color.subtle, textAlign: 'center' }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
