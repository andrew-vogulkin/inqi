/**
 * The eight Inqi persona identities (display metadata). One persona is assigned
 * per Report (1:1) at creation and carries every interaction of that report.
 * Identity (id/name/hub) lives here so the frontend can show who ran the
 * research; the writing voice + region routing stay backend-side.
 */
export interface PersonaIdentity {
  id: string;
  name: string;
  hub: string; // the proxy hub the persona operates from
}

export const PERSONA_IDENTITIES: PersonaIdentity[] = [
  { id: 'yuen', name: 'Yuen', hub: 'Hong Kong' },
  { id: 'ari', name: 'Ari', hub: 'Singapore' },
  { id: 'ellis', name: 'Ellis', hub: 'London' },
  { id: 'bo', name: 'Bo', hub: 'Amsterdam' },
  { id: 'nour', name: 'Nour', hub: 'Dubai' },
  { id: 'tumi', name: 'Tumi', hub: 'Johannesburg' },
  { id: 'marlowe', name: 'Marlowe', hub: 'New York' },
  { id: 'sol', name: 'Sol', hub: 'São Paulo' },
];

/** English-language hub used when the region is unknown. */
export const DEFAULT_PERSONA_ID = 'ellis';

const byId = new Map(PERSONA_IDENTITIES.map((p) => [p.id, p]));

/** Resolve a persona identity by id, falling back to the default hub. */
export function personaIdentity(id?: string | null): PersonaIdentity {
  return (id && byId.get(id)) || (byId.get(DEFAULT_PERSONA_ID) as PersonaIdentity);
}
