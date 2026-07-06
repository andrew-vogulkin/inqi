import { StatusTone } from './enums';

/**
 * FE-04 — the new-report scope-builder chips. Each chip is one dimension of a
 * well-scoped request. Clicking one inserts a starter `fragment` into the request
 * (the `[placeholder]` part comes back selected, so the customer types straight
 * over it); the chip flips to a ✓ once the request text covers that dimension
 * (`detect`), whether it got there via the chip or by hand.
 */
export const SuggestionTag = {
  Service: 'service',
  NearMe: 'near_me',
  BudgetSet: 'budget_set',
  FlexibleTiming: 'flexible_timing',
  PhotoUpload: 'photo_upload',
} as const;
export type SuggestionTag = (typeof SuggestionTag)[keyof typeof SuggestionTag];

export interface SuggestionTagDef {
  tag: SuggestionTag;
  label: string;
  tone: StatusTone;
  /** Not wired yet — rendered disabled with a SOON badge. */
  soon?: boolean;
  /** Inserted on click; the `[placeholder]` span gets selected for immediate typing. */
  fragment?: string;
  /** The request already covers this dimension → the chip shows as done. */
  detect?: (request: string) => boolean;
}

const has = (re: RegExp) => (request: string) => re.test(request);

export const SUGGESTION_TAGS: SuggestionTagDef[] = [
  {
    tag: SuggestionTag.Service, label: 'Service', tone: StatusTone.Brand,
    fragment: 'Looking for [what you need]',
    detect: (request) => request.trim().split(/\s+/).filter(Boolean).length >= 3, // a real "what", not one stray word
  },
  {
    tag: SuggestionTag.NearMe, label: 'Near me', tone: StatusTone.Info,
    fragment: 'near [area]',
    detect: has(/\b(near|nearby|around|close to|within \d)\b/i),
  },
  {
    tag: SuggestionTag.BudgetSet, label: 'Budget set', tone: StatusTone.Warn,
    fragment: 'budget under [amount]',
    detect: has(/\b(budget|under|up to|max|per (session|hour|person|month))\b|[£$€฿]|\b(thb|usd|eur|gbp)\b/i),
  },
  {
    tag: SuggestionTag.FlexibleTiming, label: 'Flexible timing', tone: StatusTone.Muted,
    fragment: 'timing is flexible',
    detect: has(/\b((morning|afternoon|evening|weekend|weekday)s?|flexible|anytime|any time|timing|after \d|before \d|by (mon|tue|wed|thu|fri|sat|sun|next|end))\b/i),
  },
  { tag: SuggestionTag.PhotoUpload, label: 'Photo upload', tone: StatusTone.Subtle, soon: true },
];

/** True when the request text already covers the chip's dimension. */
export function tagCovered({ def, request }: { def: SuggestionTagDef; request: string }): boolean {
  return !!def.detect && def.detect(request);
}

/**
 * Append a chip's fragment to the request (comma-joined onto existing text) and
 * return the selection range covering the `[placeholder]`, so the caller can put
 * the caret right where the customer should type.
 */
export function insertFragment({ request, fragment }: { request: string; fragment: string }): { text: string; selectStart: number; selectEnd: number } {
  const base = request.replace(/\s+$/, '');
  const sep = base.length === 0 ? '' : /[,.;:]$/.test(base) ? ' ' : ', ';
  const prefixLen = base.length + sep.length;
  const text = base + sep + fragment;
  const open = fragment.indexOf('[');
  const close = fragment.indexOf(']');
  if (open >= 0 && close > open) return { text, selectStart: prefixLen + open, selectEnd: prefixLen + close + 1 };
  return { text, selectStart: text.length, selectEnd: text.length };
}
