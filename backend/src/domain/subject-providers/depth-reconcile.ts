import { EligibilityVerdict } from '@inqi/shared';
import { SubjectProviderBackground } from './background.tokens';
import { KnownFacts } from './background.prompt';

/** The blended-quality floor at which an inquiry qualifies (also used by the settle gate). */
export const RESEARCH_QUALIFY_MIN_SCORE = 0.35;

const isHttpUrl = (u?: string | null): boolean => !!u && /^https?:\/\//i.test(u);

/** Red-flag phrasings that assert absence — contradicted when breadth already found the provider. */
const ABSENCE_FLAG =
  /(no (official )?website|zero digital footprint|does not (exist|appear)|not exist|no online presence|no (google|facebook|social|review).*(found|presence|listing))/i;

/**
 * Reconcile a depth verdict against what breadth already proved.
 *
 * Breadth resolves a real website / concrete facts before depth runs. But depth's
 * live re-verification can hit a wall — the site sits behind a bot-challenge
 * (Cloudflare "Just a moment…") so the page read is blank, and SearXNG's public
 * engines return 200-with-empty — and the model then ships an "unverified: zero
 * digital footprint" verdict with qualityScore 0. That reads as "does not exist"
 * and drops a genuine provider on the score floor.
 *
 * When (a) breadth carried hard evidence (a resolving website or named facts) and
 * (b) the verdict is only *unverified* (not a substantive "not eligible"), keep the
 * provider as an eligible-with-reservations (caution) option — quality unconfirmed,
 * ranked lower — instead of disqualifying it. Contradicted absence red-flags are
 * dropped and an honest caveat added. A real "not eligible" verdict is left intact.
 */
export function reconcileDepthVerdict({ background, knownFacts }: {
  background: SubjectProviderBackground; knownFacts?: KnownFacts | null;
}): SubjectProviderBackground {
  const website = knownFacts?.website ?? null;
  const hasBreadthEvidence = isHttpUrl(website) || (knownFacts?.facts?.length ?? 0) > 0;
  const unverified = String(background.eligibility ?? '').toLowerCase().startsWith(EligibilityVerdict.Unverified);
  if (!hasBreadthEvidence || !unverified) return background;

  const basis = isHttpUrl(website) ? `website ${website}` : 'discovery search facts';
  return {
    ...background,
    eligibility:
      `${EligibilityVerdict.EligibleWithReservations} — existence confirmed at discovery (${basis}); ` +
      'live depth re-verification was blocked (site bot-challenge or search returned no results), so quality is unconfirmed.',
    qualityScore: Math.max(background.qualityScore ?? 0, RESEARCH_QUALIFY_MIN_SCORE),
    redFlags: [
      ...(background.redFlags ?? []).filter((f) => !ABSENCE_FLAG.test(f)),
      'Live re-verification blocked (bot-challenge / empty search) — quality not independently confirmed',
    ],
  };
}
