import { CSSProperties } from 'react';
import { color, radius, space, fontSize } from '../theme/tokens';

const fieldStyle: CSSProperties = {
  width: '100%', padding: `${space[2]}px ${space[3]}px`,
  border: `1px solid ${color.lineStrong}`, borderRadius: radius.md,
  background: color.surface, color: color.ink, fontSize: fontSize.base,
  fontFamily: 'inherit', outline: 'none',
};

export function Input({
  value, onChange, placeholder, type = 'text', disabled = false,
}: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; disabled?: boolean }) {
  return (
    <input
      type={type} value={value} placeholder={placeholder} disabled={disabled}
      onChange={(e) => onChange(e.target.value)} style={fieldStyle}
    />
  );
}

export function Textarea({
  value, onChange, placeholder, rows = 4, disabled = false,
}: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; disabled?: boolean }) {
  return (
    <textarea
      value={value} placeholder={placeholder} rows={rows} disabled={disabled}
      onChange={(e) => onChange(e.target.value)} style={{ ...fieldStyle, resize: 'vertical' }}
    />
  );
}
