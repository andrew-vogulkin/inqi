/** Six-box one-time-code input logic (sign-in step 2) — pure, so every keyboard/paste rule is unit-tested. */
export const OTP_LENGTH = 6;

/** The next code value + which box to focus (null = stay put). */
export interface OtpEdit { code: string; focusIndex: number | null }

/** The code padded out to one slot per box. */
export function otpDigits(code: string): string[] {
  return code.split('').concat(Array(OTP_LENGTH).fill('')).slice(0, OTP_LENGTH);
}

const commit = (arr: string[]): string => arr.join('').replace(/\D/g, '');

/** Typing into box `index`: the LAST digit typed overrides the slot, then focus advances. */
export function applyDigit({ code, index, raw }: { code: string; index: number; raw: string }): OtpEdit {
  const digit = raw.replace(/\D/g, '').slice(-1);
  const arr = otpDigits(code);
  arr[index] = digit;
  return { code: commit(arr), focusIndex: digit && index < OTP_LENGTH - 1 ? index + 1 : null };
}

/** Backspace: clear the current slot, or step back and clear the previous one when already empty. */
export function applyBackspace({ code, index }: { code: string; index: number }): OtpEdit {
  const arr = otpDigits(code);
  if (arr[index]) {
    arr[index] = '';
    return { code: commit(arr), focusIndex: null };
  }
  if (index > 0) {
    arr[index - 1] = '';
    return { code: commit(arr), focusIndex: index - 1 };
  }
  return { code, focusIndex: null };
}

/** Paste anywhere: digits fill from the first box; focus lands after the last pasted digit. */
export function applyPaste({ text }: { text: string }): OtpEdit | null {
  const digits = text.replace(/\D/g, '').slice(0, OTP_LENGTH);
  if (!digits) return null;
  const arr = Array<string>(OTP_LENGTH).fill('');
  for (let i = 0; i < digits.length; i++) arr[i] = digits[i];
  return { code: commit(arr), focusIndex: Math.min(digits.length, OTP_LENGTH - 1) };
}
