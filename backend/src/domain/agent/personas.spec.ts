import { DEFAULT_PERSONA_ID, FORCED_PERSONA_ID, PERSONAS, assignPersona, pickPersona } from './personas';

describe('pickPersona — hub routing with a random fallback', () => {
  it('routes by the geo label when present', () => {
    expect(pickPersona({ regionHint: 'Bangkok, Thailand' }).id).toBe('ari');
    expect(pickPersona({ regionHint: 'Amsterdam' }).id).toBe('bo');
  });

  it('falls back to places named in the request text (customers rarely set a geo label)', () => {
    expect(pickPersona({ regionHint: null, requestText: 'best cocktail bars in Bangkok central area' }).id).toBe('ari');
    expect(pickPersona({ regionHint: null, requestText: 'a wedding florist in Edinburgh' }).id).toBe('ellis');
    expect(pickPersona({ regionHint: null, requestText: 'taco catering in Mexico City' }).id).toBe('sol');
    expect(pickPersona({ regionHint: null, requestText: 'sushi omakase in Tokyo under ¥20k' }).id).toBe('yuen');
  });

  it('the geo label wins over the request text', () => {
    expect(pickPersona({ regionHint: 'Dubai', requestText: 'a chef trained in Bangkok' }).id).toBe('nour');
  });

  it('no regional signal → picks across the whole fleet (not always the default)', () => {
    const ids = PERSONAS.map((_, i) => pickPersona({ requestText: 'a padel coach', rng: () => i / PERSONAS.length }).id);
    expect(new Set(ids).size).toBe(PERSONAS.length); // every persona is reachable
    expect(ids).toContain(DEFAULT_PERSONA_ID);       // the old default is just one of them
  });

  it('rng edge: roll of ~1 stays in bounds', () => {
    expect(pickPersona({ requestText: 'x', rng: () => 0.999999 })).toBeDefined();
  });
});

describe('assignPersona — the FORCED_PERSONA_ID pin (email-approval mode)', () => {
  it('the hardcoded pin, when set, must be a real persona id (a typo would silently unpin the fleet)', () => {
    if (FORCED_PERSONA_ID !== null) {
      expect(PERSONAS.some((p) => p.id === FORCED_PERSONA_ID)).toBe(true);
      expect(assignPersona({ forcedId: FORCED_PERSONA_ID, regionHint: 'Munich' }).id).toBe(FORCED_PERSONA_ID);
    }
  });

  it('a forced id wins over every regional signal', () => {
    expect(assignPersona({ forcedId: 'marlowe', regionHint: 'Munich', requestText: 'grooming in Munich' }).id).toBe('marlowe');
  });

  it('an unknown forced id falls back to normal routing (never silently remapped)', () => {
    expect(assignPersona({ forcedId: 'nobody', regionHint: 'Amsterdam' }).id).toBe('bo');
  });

  it('no forced id → identical to pickPersona routing', () => {
    expect(assignPersona({ forcedId: null, regionHint: 'Dubai' }).id).toBe('nour');
  });
});
