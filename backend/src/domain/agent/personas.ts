import { PERSONA_IDENTITIES, DEFAULT_PERSONA_ID, PersonaIdentity } from '@inqi/shared';

/** Eight Inqi agent personas, each a "local" of a regional **proxy hub**. When we
 *  reach out to a subject provider, we route to the persona whose hub serves that
 *  region, so the contact reads as a plausible local (better trust + reply rates).
 *  Identity (id/name/hub) lives in `@inqi/shared` (the FE shows who ran the
 *  research); the region routing + writing voice — anchored to 21st-century
 *  literature of the region — stay here. One persona owns an email thread end to end. */
export interface Persona extends PersonaIdentity {
  serves: string[]; // region/country tokens this hub is the local for (codes + names)
  style: string;   // writing voice injected into the system prompt
}

/** Voice + routing per persona id (composed with the shared identities below). */
const VOICES: Record<string, { serves: string[]; style: string }> = {
  yuen: {
    serves: ['hk', 'hong kong', 'cn', 'china', 'tw', 'taiwan', 'jp', 'japan', 'kr', 'korea', 'east asia', 'tokyo', 'osaka', 'kyoto', 'seoul', 'taipei', 'shanghai', 'beijing', 'shenzhen'],
    style: 'Quiet East-Asian observational economy: understated, polite, precise, nothing wasted.' },
  ari: {
    serves: ['sg', 'singapore', 'in', 'india', 'my', 'malaysia', 'id', 'indonesia', 'th', 'thailand', 'vn', 'vietnam', 'ph', 'philippines', 'south asia', 'southeast asia', 'bangkok', 'chiang mai', 'phuket', 'mumbai', 'delhi', 'bangalore', 'jakarta', 'bali', 'kuala lumpur', 'manila', 'hanoi', 'ho chi minh'],
    style: 'Layered South/Southeast-Asian warmth: hospitable, detail-rich, courteous, gently expansive.' },
  ellis: {
    serves: ['uk', 'gb', 'united kingdom', 'england', 'london', 'ie', 'ireland', 'western europe', 'manchester', 'edinburgh', 'glasgow', 'dublin', 'bristol'],
    style: 'Restrained European precision: formal clarity, measured tone, dry economy, impeccable courtesy.' },
  bo: {
    serves: ['nl', 'netherlands', 'amsterdam', 'de', 'germany', 'cz', 'czech', 'czechia', 'prague', 'pl', 'poland', 'be', 'belgium', 'central europe', 'berlin', 'munich', 'hamburg', 'rotterdam', 'warsaw', 'brussels', 'vienna', 'austria', 'zurich', 'switzerland'],
    style: 'Plain, well-organised Dutch / Central-European clarity: direct, friendly, exact.' },
  nour: {
    serves: ['ae', 'uae', 'united arab emirates', 'dubai', 'sa', 'saudi', 'qa', 'qatar', 'kw', 'kuwait', 'middle east', 'west asia', 'gulf', 'abu dhabi', 'riyadh', 'jeddah', 'doha', 'eg', 'egypt', 'cairo', 'amman', 'beirut'],
    style: 'Measured West-Asian courtesy: dignified, allusive, respectful, unhurried.' },
  tumi: {
    serves: ['za', 'south africa', 'johannesburg', 'ng', 'nigeria', 'ke', 'kenya', 'gh', 'ghana', 'africa', 'sub-saharan', 'cape town', 'lagos', 'nairobi', 'accra', 'durban'],
    style: 'The cadence of contemporary African storytelling: rhythmic, communal warmth, the occasional well-placed proverb.' },
  marlowe: {
    serves: ['us', 'usa', 'united states', 'new york', 'ca', 'canada', 'north america', 'nyc', 'los angeles', 'chicago', 'san francisco', 'seattle', 'boston', 'austin', 'miami', 'denver', 'toronto', 'vancouver', 'montreal'],
    style: 'Spare, understated North-American realist prose: short declarative sentences, concrete nouns, no flourish.' },
  sol: {
    serves: ['br', 'brazil', 'sao paulo', 'são paulo', 'ar', 'argentina', 'cl', 'chile', 'co', 'colombia', 'mx', 'mexico', 'latin america', 'south america', 'rio de janeiro', 'buenos aires', 'santiago', 'bogota', 'bogotá', 'lima', 'peru', 'mexico city', 'medellin', 'medellín'],
    style: 'Warm, lyrical Latin-American cadence: vivid but economical imagery, generous courtesy, a human touch.' },
};

export const PERSONAS: Persona[] = PERSONA_IDENTITIES.map((p) => ({ ...p, ...VOICES[p.id] }));

export { DEFAULT_PERSONA_ID };
const byId = new Map(PERSONAS.map((p) => [p.id, p]));

export const getPersona = ({ id }: { id?: string | null }): Persona => (id && byId.get(id)) || byId.get(DEFAULT_PERSONA_ID)!;

function matches({ hint, serves, freeText }: { hint: string; serves: string[]; freeText?: boolean }): boolean {
  const h = hint.toLowerCase().trim();
  const tokens = h.split(/[^a-zà-ú]+/).filter(Boolean);
  // Free request text: skip the 2-letter country codes — 'in', 'my', 'us', 'ie'
  // are ordinary English words there ("florist in Edinburgh" is not India).
  const usable = freeText ? serves.filter((s) => s.length > 2) : serves;
  return usable.some((s) => (s.includes(' ') ? h.includes(s) : tokens.includes(s)));
}

/** Region-aware routing: pick the proxy-hub persona local to the subject
 *  provider's region/country. Falls back to scanning the raw request text
 *  (customers rarely set a geo label but usually name a place — "bars in
 *  Bangkok"), and with no regional signal at all picks at random — the agent
 *  fleet must not read as one person running every report. */
export function pickPersona({ regionHint, requestText, rng }: { regionHint?: string | null; requestText?: string | null; rng?: () => number }): Persona {
  if (regionHint) for (const p of PERSONAS) if (matches({ hint: regionHint, serves: p.serves })) return p;
  if (requestText) for (const p of PERSONAS) if (matches({ hint: requestText, serves: p.serves, freeText: true })) return p;
  const roll = (rng ?? Math.random)();
  return PERSONAS[Math.min(PERSONAS.length - 1, Math.floor(roll * PERSONAS.length))];
}

/** System prompt: persona identity + hub + employer framing + writing voice. */
export function personaSystem({ persona, task }: { persona: Persona; task: string }): string {
  return [
    `You are ${persona.name}, a report specialist at "Inqi Tech Service Provider", working from our ${persona.hub} hub.`,
    `You contact subject providers on behalf of a client to ask about availability, price, lead time and terms.`,
    `Be professional and honest; never misrepresent who you are or why you are writing.`,
    `You personally own this email thread — the same person (you, ${persona.name}) always replies.`,
    `Writing voice: ${persona.style}`,
    task,
  ].join(' ');
}
