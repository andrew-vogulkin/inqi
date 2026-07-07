/** A page we opened but couldn't actually read: a bot-challenge (Cloudflare) or a login wall. */
export interface PageBlock {
  blocked: boolean;
  reason?: string;
}

/** Interstitial signatures — Cloudflare "Just a moment…", "checking your browser", etc. */
const CHALLENGE =
  /(just a moment|attention required|checking (if|that|your) .*(secure|browser|connection)|enable javascript and cookies|verify(ing)? (that )?you are (a )?human|cf-browser-verification|needs to review the security of your connection)/i;

/** Login-wall signatures — a logged-out visitor bounced to a sign-in prompt. */
const LOGIN_WALL =
  /(log ?in to (facebook|instagram|continue)|you must log in|sign in to continue|please log in to continue|login required)/i;

/**
 * Classify a page read as blocked when the site served a bot-challenge or a login
 * wall instead of content — so the caller treats it as **unreadable**, NOT "empty"
 * or "does not exist" (which wrongly reads as the provider not existing).
 *
 * Text-signature checks require a short body: a challenge/login page is tiny, so a
 * length gate avoids flagging a real, content-rich page that merely links to a login.
 */
export function detectPageBlock({ status, finalUrl, title, text }: {
  status?: number | null; finalUrl?: string | null; title?: string | null; text?: string | null;
}): PageBlock {
  if (typeof status === 'number' && status >= 400) return { blocked: true, reason: `http ${status}` };
  if (finalUrl && /\/(login|checkpoint|signin|sign_in)\b/i.test(finalUrl)) return { blocked: true, reason: 'login wall (redirected to sign-in)' };

  const t = title ?? '';
  const body = text ?? '';
  const short = body.length < 500;
  if (CHALLENGE.test(t) || (short && CHALLENGE.test(`${t}\n${body}`))) return { blocked: true, reason: 'bot challenge (e.g. Cloudflare)' };
  if (short && LOGIN_WALL.test(`${t}\n${body}`)) return { blocked: true, reason: 'login wall' };
  return { blocked: false };
}
