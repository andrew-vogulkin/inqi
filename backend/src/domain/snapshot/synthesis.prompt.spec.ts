import { synthesisSchema } from './synthesis.prompt';

describe('synthesisSchema', () => {
  it('parses a summary and defaults highlights', () => {
    const r = synthesisSchema.parse({ summary: 'Three solid options; the top one leads on quality.' });
    expect(r.summary).toContain('quality');
    expect(r.highlights).toEqual([]);
  });

  it('rejects an empty summary', () => {
    expect(() => synthesisSchema.parse({ summary: '' })).toThrow();
  });

  it('rejects a missing summary', () => {
    expect(() => synthesisSchema.parse({ highlights: ['a'] })).toThrow();
  });
});
