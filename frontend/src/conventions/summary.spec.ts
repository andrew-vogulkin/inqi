import { describe, it, expect } from 'vitest';
import { linkifySummary } from './summary';

const targets = [
  { name: 'Ericeira Surf School', href: '#/d/r1/Ericeira%20Surf%20School' },
  { name: 'Ericeira Surf Camp & Hostel', href: '#/d/r1/Ericeira%20Surf%20Camp%20%26%20Hostel' },
  { name: 'Mellowmove Surf Camp', href: '#/d/r1/Mellowmove%20Surf%20Camp' },
];

describe('linkifySummary — provider names → dossier links', () => {
  it('links every occurrence of a known option name', () => {
    const s = linkifySummary({
      summary: 'Ericeira Surf School leads at 85 EUR. Mellowmove Surf Camp is a strong alternative.',
      targets,
    });
    expect(s).toEqual([
      { text: 'Ericeira Surf School', href: '#/d/r1/Ericeira%20Surf%20School' },
      { text: ' leads at 85 EUR. ' },
      { text: 'Mellowmove Surf Camp', href: '#/d/r1/Mellowmove%20Surf%20Camp' },
      { text: ' is a strong alternative.' },
    ]);
  });

  it('prefers the longest name when one contains another', () => {
    const s = linkifySummary({ summary: 'Consider Ericeira Surf Camp & Hostel too.', targets });
    expect(s[1]).toEqual({ text: 'Ericeira Surf Camp & Hostel', href: '#/d/r1/Ericeira%20Surf%20Camp%20%26%20Hostel' });
  });

  it('matches case-insensitively but keeps the summary casing', () => {
    const s = linkifySummary({ summary: 'ERICEIRA SURF SCHOOL wins.', targets });
    expect(s[0]).toEqual({ text: 'ERICEIRA SURF SCHOOL', href: '#/d/r1/Ericeira%20Surf%20School' });
  });

  it('returns plain text when nothing matches or there are no targets', () => {
    expect(linkifySummary({ summary: 'No providers qualified.', targets })).toEqual([{ text: 'No providers qualified.' }]);
    expect(linkifySummary({ summary: 'Hello.', targets: [] })).toEqual([{ text: 'Hello.' }]);
    expect(linkifySummary({ summary: '', targets })).toEqual([]);
  });

  it('escapes regex metacharacters in names', () => {
    const s = linkifySummary({
      summary: 'Rancilio (Vienna) repairs fast.',
      targets: [{ name: 'Rancilio (Vienna)', href: '#/d/r2/x' }],
    });
    expect(s[0]).toEqual({ text: 'Rancilio (Vienna)', href: '#/d/r2/x' });
  });
});
