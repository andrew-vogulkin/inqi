/**
 * Subject-level golden cases for the subject_build rehearsal: a request + what the
 * built Subject must satisfy. Checkable structurally (built vs naive-fallback,
 * category, title keywords) so a candidate composition can be scored without an
 * LLM judge; a judged quality dimension can layer on later.
 */
export interface SubjectExpect {
  mustBuild: boolean;         // the composition persisted a Subject (didn't dead-end → naive fallback)
  notNaive?: boolean;         // the title isn't just rawRequest.slice(0,80)
  category?: string;          // expected SubjectCategory
  titleIncludes?: string[];   // keywords the title should contain (case-insensitive)
}

export interface SubjectCase {
  id: string;
  request: string;
  enriched?: { title?: string; category?: string; summary?: string };
  expect: SubjectExpect;
}

export const SUBJECT_CASES: SubjectCase[] = [
  { id: 'hillcreek', request: 'A wedding and events venue in Tagaytay, Philippines for around 150 guests with outdoor ceremony space.', expect: { mustBuild: true, notNaive: true, titleIncludes: ['venue'] } },
  { id: 'plumber-lisbon', request: 'A reliable local plumber for a bathroom renovation in Lisbon, mid-range budget.', expect: { mustBuild: true, notNaive: true } },
  { id: 'pikachu', request: 'A Pikachu Pokemon trading card to buy, good condition.', expect: { mustBuild: true, notNaive: true, titleIncludes: ['pikachu'] } },
  { id: 'apartment-porto', request: 'A two-bedroom apartment to rent long-term in central Porto, under 1200 euros a month.', expect: { mustBuild: true, notNaive: true } },
];
