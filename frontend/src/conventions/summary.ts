/** One run of summary text; `href` set when the run is a provider name linking to its dossier. */
export interface SummarySegment { text: string; href?: string }

/** A linkable target: the provider name as it appears in the text + its dossier href. */
export interface SummaryLinkTarget { name: string; href: string }

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Split a report summary into text/link segments: every occurrence of a known
 * option name becomes a link to that option's dossier. Longest names match first
 * ("Ericeira Surf Camp & Hostel" before "Ericeira Surf Camp"), matching is
 * case-insensitive, and the original casing of the summary text is preserved.
 */
export function linkifySummary({ summary, targets }: { summary: string; targets: SummaryLinkTarget[] }): SummarySegment[] {
  const usable = targets.filter((t) => t.name.trim().length > 1);
  if (!summary || usable.length === 0) return summary ? [{ text: summary }] : [];

  const byLengthDesc = [...usable].sort((a, b) => b.name.length - a.name.length);
  const pattern = new RegExp(byLengthDesc.map((t) => escapeRegExp(t.name)).join('|'), 'gi');

  const segments: SummarySegment[] = [];
  let cursor = 0;
  for (let m = pattern.exec(summary); m; m = pattern.exec(summary)) {
    if (m.index > cursor) segments.push({ text: summary.slice(cursor, m.index) });
    const hit = m[0];
    const target = byLengthDesc.find((t) => t.name.toLowerCase() === hit.toLowerCase());
    segments.push(target ? { text: hit, href: target.href } : { text: hit });
    cursor = m.index + hit.length;
  }
  if (cursor < summary.length) segments.push({ text: summary.slice(cursor) });
  return segments;
}
