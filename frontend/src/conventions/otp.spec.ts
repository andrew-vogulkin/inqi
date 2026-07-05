import { describe, it, expect } from 'vitest';
import { OTP_LENGTH, otpDigits, applyDigit, applyBackspace, applyPaste } from './otp';

describe('otpDigits', () => {
  it('pads a partial code to one slot per box', () => {
    expect(otpDigits('12')).toEqual(['1', '2', '', '', '', '']);
    expect(otpDigits('')).toHaveLength(OTP_LENGTH);
  });
});

describe('applyDigit — type to fill, auto-advance', () => {
  it('sets the slot and advances focus', () => {
    expect(applyDigit({ code: '', index: 0, raw: '1' })).toEqual({ code: '1', focusIndex: 1 });
  });

  it('the LAST digit typed overrides the slot (fast typists double-hit)', () => {
    expect(applyDigit({ code: '123456', index: 2, raw: '39' })).toEqual({ code: '129456', focusIndex: 3 });
  });

  it('non-digits are ignored; clearing a slot does not move focus', () => {
    expect(applyDigit({ code: '12', index: 1, raw: '' })).toEqual({ code: '1', focusIndex: null });
    expect(applyDigit({ code: '', index: 0, raw: 'a' })).toEqual({ code: '', focusIndex: null });
  });

  it('the last box never advances past the end', () => {
    expect(applyDigit({ code: '12345', index: 5, raw: '6' })).toEqual({ code: '123456', focusIndex: null });
  });
});

describe('applyBackspace — clear here, or step back', () => {
  it('clears the filled current slot and stays', () => {
    expect(applyBackspace({ code: '123', index: 2 })).toEqual({ code: '12', focusIndex: null });
  });

  it('on an empty slot: clears the previous one and moves back', () => {
    expect(applyBackspace({ code: '12', index: 2 })).toEqual({ code: '1', focusIndex: 1 });
  });

  it('box 0 empty is a no-op', () => {
    expect(applyBackspace({ code: '', index: 0 })).toEqual({ code: '', focusIndex: null });
  });
});

describe('applyPaste — distribute from box 0', () => {
  it('fills from the start and focuses after the last digit', () => {
    expect(applyPaste({ text: '123' })).toEqual({ code: '123', focusIndex: 3 });
  });

  it('strips non-digits and caps at 6 ("code: 12-34-56-78" → 123456)', () => {
    expect(applyPaste({ text: 'code: 12-34-56-78' })).toEqual({ code: '123456', focusIndex: 5 });
  });

  it('a paste with no digits is ignored', () => {
    expect(applyPaste({ text: 'hello' })).toBeNull();
  });
});
