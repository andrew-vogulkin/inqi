import { ReactNode } from 'react';
import { color, radius, space, fontSize, fontWeight } from '../theme/tokens';

/** A filter chip — single (radio-like) or multi (toggle), driven by `selected`. */
export function Chip({ label, selected = false, onClick }: { label: ReactNode; selected?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        background: selected ? color.brandTint : color.surface,
        color: selected ? color.brandStrong : color.inkSoft,
        border: `1px solid ${selected ? color.brand : color.lineStrong}`,
        borderRadius: radius.pill, padding: `${space[1]}px ${space[3]}px`,
        fontSize: fontSize.sm, fontWeight: fontWeight.medium, cursor: 'pointer',
      }}
    >{label}</button>
  );
}

/** A single-select filter bar over a set of options (multi handled by caller state). */
export function FilterBar<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
      {options.map((o) => <Chip key={o.value} label={o.label} selected={o.value === value} onClick={() => onChange(o.value)} />)}
    </div>
  );
}

/** A static pill (non-interactive label, e.g. a tag). */
export function Pill({ children }: { children: ReactNode }) {
  return (
    <span style={{
      display: 'inline-block', background: color.surfaceSunken, color: color.muted,
      border: `1px solid ${color.line}`, borderRadius: radius.pill,
      padding: `1px ${space[2]}px`, fontSize: fontSize.xs,
    }}>{children}</span>
  );
}
