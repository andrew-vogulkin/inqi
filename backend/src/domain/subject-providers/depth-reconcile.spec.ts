import { reconcileDepthVerdict, RESEARCH_QUALIFY_MIN_SCORE } from './depth-reconcile';
import { SubjectProviderBackground } from './background.tokens';

const bg = (over: Partial<SubjectProviderBackground>): SubjectProviderBackground => ({
  eligibility: 'unverified — exhaustive web searches returned zero results',
  qualityScore: 0,
  redFlags: ['No official website found', 'Zero digital footprint across all major platforms'],
  sources: [],
  ...over,
});

describe('reconcileDepthVerdict', () => {
  it('rescues an "unverified" verdict when breadth found a resolving website', () => {
    const out = reconcileDepthVerdict({ background: bg({}), knownFacts: { website: 'https://www.hillcreekgardenstagaytay.com/', socials: [], facts: [] } });
    expect(out.eligibility.startsWith('eligible with reservations')).toBe(true); // qualifies as a caution option
    expect(out.eligibility).toContain('hillcreekgardenstagaytay.com');
    expect(out.qualityScore).toBe(RESEARCH_QUALIFY_MIN_SCORE); // floored off the score floor
    expect(out.redFlags).not.toContain('No official website found');       // contradicted flags dropped
    expect(out.redFlags.some((f) => /blocked/i.test(f))).toBe(true);        // honest caveat added
  });

  it('rescues on discovery facts alone (no website captured)', () => {
    const out = reconcileDepthVerdict({ background: bg({}), knownFacts: { website: null, socials: [], facts: ['Outdoor ceremony lawn', 'On-site hotel + restaurant'] } });
    expect(out.eligibility.startsWith('eligible with reservations')).toBe(true);
    expect(out.eligibility).toContain('discovery search facts');
  });

  it('leaves it unverified when breadth found nothing (a true dead end)', () => {
    const out = reconcileDepthVerdict({ background: bg({}), knownFacts: { website: null, socials: [], facts: [] } });
    expect(out.eligibility.startsWith('unverified')).toBe(true);
    expect(out.qualityScore).toBe(0);
  });

  it('never overrides a substantive "not eligible" verdict, even with a website', () => {
    const notEligible = bg({ eligibility: 'not eligible — venue seats 30, request needs 200', redFlags: ['Capacity far below requirement'], qualityScore: 0.1 });
    const out = reconcileDepthVerdict({ background: notEligible, knownFacts: { website: 'https://x.example', socials: [], facts: ['exists'] } });
    expect(out).toEqual(notEligible); // real disqualification preserved untouched
  });

  it('leaves an already-eligible verdict untouched', () => {
    const eligible = bg({ eligibility: 'eligible', redFlags: [], qualityScore: 0.7 });
    const out = reconcileDepthVerdict({ background: eligible, knownFacts: { website: 'https://x.example', socials: [], facts: [] } });
    expect(out).toEqual(eligible);
  });
});
