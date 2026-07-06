import { color, radius } from '../theme/tokens';

/** A shimmer placeholder for loading states. */
export function Skeleton({ width = '100%', height = 14, rounded = false }: { width?: number | string; height?: number; rounded?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block', width, height,
        borderRadius: rounded ? radius.pill : radius.sm,
        background: `linear-gradient(90deg, ${color.surfaceSunken}, ${color.surfaceAlt}, ${color.surfaceSunken})`,
        backgroundSize: '200% 100%', animation: 'inqi-shimmer 1.2s ease-in-out infinite',
      }}
    />
  );
}
