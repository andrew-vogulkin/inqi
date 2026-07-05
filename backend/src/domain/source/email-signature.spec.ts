import { signEmail, SIGNATURE_BRAND } from './email-signature';

const CANON = `Best regards,\nBo\n${SIGNATURE_BRAND}`;

describe('signEmail — hardcoded signature (anti-hallucination)', () => {
  it('appends the canonical block to an unsigned body', () => {
    expect(signEmail({ body: 'Could you share the cost estimate and timeline?', personaName: 'Bo' }))
      .toBe(`Could you share the cost estimate and timeline?\n\n${CANON}`);
  });

  it('strips a model-written sign-off + name (the observed double-signature case)', () => {
    const body = 'The dog weighs 32 kg. Please share pricing and lead time.\n\nBest,\nBo\n\nBo';
    expect(signEmail({ body, personaName: 'Bo' }))
      .toBe(`The dog weighs 32 kg. Please share pricing and lead time.\n\n${CANON}`);
  });

  it('strips a bare trailing name line without a sign-off word', () => {
    expect(signEmail({ body: 'Weekday mornings work.\n\nBo', personaName: 'Bo' }))
      .toBe(`Weekday mornings work.\n\n${CANON}`);
  });

  it('strips a full self-written signature including the brand line', () => {
    const body = `Happy to proceed.\n\nWarm regards,\nBo Janssen\n${SIGNATURE_BRAND}`;
    expect(signEmail({ body, personaName: 'Bo Janssen' }))
      .toBe(`Happy to proceed.\n\nBest regards,\nBo Janssen\n${SIGNATURE_BRAND}`);
  });

  it('keeps a final content sentence that merely contains thanks', () => {
    const body = 'Thank you for the quick response about pricing.';
    expect(signEmail({ body, personaName: 'Bo' })).toBe(`${body}\n\n${CANON}`);
  });

  it('never signs an empty remainder — falls back to the original body', () => {
    expect(signEmail({ body: 'Cheers,\nBo', personaName: 'Bo' })).toBe(`Cheers,\nBo\n\n${CANON}`);
  });

  it('strips an INLINE sign-off at the end of the last paragraph (observed live)', () => {
    const body = 'Please proceed with preparing the updated binding quote based on this information. Best regards, Bo';
    expect(signEmail({ body, personaName: 'Bo' }))
      .toBe(`Please proceed with preparing the updated binding quote based on this information.\n\n${CANON}`);
  });

  it('keeps "best" used mid-sentence — only a trailing sign-off+name is inline-stripped', () => {
    const body = 'We want the best regards to grooming quality for Bo.';
    expect(signEmail({ body, personaName: 'Bo' })).toBe(`${body}\n\n${CANON}`);
  });
});
