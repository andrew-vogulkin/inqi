import { describe, expect, it } from 'vitest';
import { SUGGESTION_TAGS, SuggestionTag, insertFragment, tagCovered } from './suggestions';

const def = (tag: SuggestionTag) => SUGGESTION_TAGS.find((t) => t.tag === tag)!;

describe('tagCovered — the request already covers the chip dimension', () => {
  it('Service: three words of "what" count, a stray word does not', () => {
    expect(tagCovered({ def: def(SuggestionTag.Service), request: 'pilates' })).toBe(false);
    expect(tagCovered({ def: def(SuggestionTag.Service), request: 'reformer pilates classes' })).toBe(true);
  });

  it('Near me: location phrasing in any form', () => {
    expect(tagCovered({ def: def(SuggestionTag.NearMe), request: 'a bar near Shoreditch' })).toBe(true);
    expect(tagCovered({ def: def(SuggestionTag.NearMe), request: 'somewhere around Chinatown' })).toBe(true);
    expect(tagCovered({ def: def(SuggestionTag.NearMe), request: 'a bar in style' })).toBe(false);
  });

  it('Budget set: currency symbols, codes and budget phrasing', () => {
    expect(tagCovered({ def: def(SuggestionTag.BudgetSet), request: 'under £30 a session' })).toBe(true);
    expect(tagCovered({ def: def(SuggestionTag.BudgetSet), request: 'about 5000 THB per person' })).toBe(true);
    expect(tagCovered({ def: def(SuggestionTag.BudgetSet), request: 'a nice cocktail bar' })).toBe(false);
  });

  it('Flexible timing: daypart / flexibility phrasing', () => {
    expect(tagCovered({ def: def(SuggestionTag.FlexibleTiming), request: 'evenings preferred' })).toBe(true);
    expect(tagCovered({ def: def(SuggestionTag.FlexibleTiming), request: 'timing is flexible' })).toBe(true);
    expect(tagCovered({ def: def(SuggestionTag.FlexibleTiming), request: 'a padel coach' })).toBe(false);
  });

  it('Photo upload (soon) is never covered', () => {
    expect(tagCovered({ def: def(SuggestionTag.PhotoUpload), request: 'photo upload of anything' })).toBe(false);
  });
});

describe('insertFragment — appends the starter and selects its [placeholder]', () => {
  it('empty request: fragment stands alone, placeholder selected', () => {
    const r = insertFragment({ request: '', fragment: 'near [area]' });
    expect(r.text).toBe('near [area]');
    expect(r.text.slice(r.selectStart, r.selectEnd)).toBe('[area]');
  });

  it('existing text: comma-joined, placeholder selected', () => {
    const r = insertFragment({ request: 'reformer pilates classes', fragment: 'budget under [amount]' });
    expect(r.text).toBe('reformer pilates classes, budget under [amount]');
    expect(r.text.slice(r.selectStart, r.selectEnd)).toBe('[amount]');
  });

  it('text already ending in punctuation: no double separator', () => {
    const r = insertFragment({ request: 'a wine bar,', fragment: 'near [area]' });
    expect(r.text).toBe('a wine bar, near [area]');
  });

  it('fragment without a placeholder: caret lands at the end', () => {
    const r = insertFragment({ request: 'a wine bar', fragment: 'timing is flexible' });
    expect(r.text).toBe('a wine bar, timing is flexible');
    expect(r.selectStart).toBe(r.text.length);
    expect(r.selectEnd).toBe(r.text.length);
  });
});
