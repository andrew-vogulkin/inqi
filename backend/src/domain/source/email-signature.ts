/** The canonical brand line of every outgoing email signature. */
export const SIGNATURE_BRAND = 'Inqi Tech Service Provider';

const SIGN_OFF_WORDS = 'best regards|kind regards|warm regards|warmest regards|regards|sincerely|best wishes|best|cheers|thanks|thank you|many thanks|yours truly|yours sincerely|warmly|with gratitude';

/** A line that is (only) a conventional email sign-off ("Best regards,", "Thanks!", …). */
const SIGN_OFF = new RegExp(`^(${SIGN_OFF_WORDS})[,.!]?$`, 'i');

/** True when the line consists only of tokens of the persona's name ("Bo", "Bo Janssen"). */
function isNameLine({ line, personaName }: { line: string; personaName: string }): boolean {
  const nameTokens = personaName.toLowerCase().split(/\s+/).filter(Boolean);
  const lineTokens = line.toLowerCase().replace(/[,.]/g, '').split(/\s+/).filter(Boolean);
  return lineTokens.length > 0 && lineTokens.every((t) => nameTokens.includes(t));
}

/**
 * Deterministic signature: strip whatever sign-off the model wrote (models sign
 * despite instructions — the very thing that hallucinated a double "Bo") and
 * append the ONE canonical block:
 *
 *   Best regards,
 *   <persona name>
 *   Inqi Tech Service Provider
 */
export function signEmail({ body, personaName }: { body: string; personaName: string }): string {
  const lines = body.trimEnd().split('\n');
  let end = lines.length;
  // Walk up over the trailing signature region: blank / name / brand lines are
  // strippable; a sign-off line takes everything from itself down; any other
  // content line ends the walk.
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 6; i--) {
    const line = lines[i].trim();
    if (SIGN_OFF.test(line)) { end = i; break; }
    if (line === '' || isNameLine({ line, personaName }) || line.toLowerCase().includes(SIGNATURE_BRAND.toLowerCase())) {
      end = i;
      continue;
    }
    break;
  }
  let stripped = lines.slice(0, end).join('\n').trimEnd();
  // Models also sign INLINE at the end of the last paragraph ("… the quote. Best regards, Bo").
  const name = personaName.split(/\s+/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  stripped = stripped.replace(new RegExp(`[\\s,;–—-]*(${SIGN_OFF_WORDS})[\\s,]+${name}[\\s.!]*$`, 'i'), '').trimEnd();
  const content = stripped || body.trim(); // never sign an empty body because the walk ate everything
  return `${content}\n\nBest regards,\n${personaName}\n${SIGNATURE_BRAND}`;
}
