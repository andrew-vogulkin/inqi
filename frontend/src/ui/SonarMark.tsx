import { CSSProperties } from 'react';
import { color } from '../theme/tokens';

/** Echo targets (x, y, size, tone, delay s) laid out for the 140×140 stage — scaled with `size`. */
const ECHOES: [number, number, number, string, number][] = [
  [95.1, 22.1, 6, '#3fd089', 0.3],
  [12.2, 55.4, 6, color.brand, 0.33],
  [84.2, 118.9, 5, '#3fd089', 0.31],
  [120.6, 47.5, 6, color.brand, 0.6],
  [22.4, 99.0, 5, '#3fd089', 0.62],
  [117.7, 96.5, 5, '#a9e3c8', 0.58],
];
const STAGE = 140; // the design's reference stage; everything scales off it

/**
 * The animated inqi brand mark — design "Variant B · Sonar": the `i` pulses with a
 * slow lub-dub heartbeat (2s ≈ resting pulse), each beat sends a wavefront out, and
 * echo dots light up the instant the wave reaches them ("agents finding providers").
 * Purely decorative — hidden from the accessibility tree, still under reduced motion.
 */
export function SonarMark({ size = 140, markSize = 56 }: { size?: number; markSize?: number }) {
  const k = size / STAGE;
  const dot = ([x, y, d, tone, delay]: [number, number, number, string, number], i: number): JSX.Element => (
    <span key={i} style={{
      position: 'absolute', left: x * k, top: y * k, width: d * k, height: d * k, borderRadius: '50%',
      background: tone, opacity: 0, animation: 'inqi-sonar-echo 2s ease-out infinite', animationDelay: `${delay}s`,
    }} />
  );
  const ring = (anim: string, border: number): CSSProperties => ({
    position: 'absolute', top: '50%', left: '50%', width: markSize * k * (56 / 60), height: markSize * k * (56 / 60),
    borderRadius: 18 * k, border: `${border}px solid ${color.brand}`,
    animation: `${anim} 2s cubic-bezier(.15,.5,.5,1) infinite`,
  });
  return (
    <div aria-hidden data-sonar style={{ position: 'relative', width: size, height: size }}>
      {/* primary wavefront (the 'lub') + faint second beat (the 'dub') */}
      <span style={ring('inqi-sonar-wave', 2)} />
      <span style={ring('inqi-sonar-wave-dub', 1.5)} />
      {ECHOES.map(dot)}
      {/* the i mark, beating */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%', width: markSize * k, height: markSize * k,
        borderRadius: 16 * k, background: color.brand, color: color.onSolid,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: markSize * k / 2,
        animation: 'inqi-sonar-heart 2s ease-in-out infinite',
      }}>i</div>
    </div>
  );
}
