import { InquiryStatus, MessageStatus } from '@inqi/shared';
import { InquiryOutreachVariant, StatusTone } from './enums';
import { toneForInquiryStatus } from '../ui/tone';
import { ThreadMessageDto } from '../api/types';

/** An inquiry record as held on the admin board (FE-10 → FE-11). */
export interface InquiryRecord {
  id: string;
  epicId: string;
  provider: string;
  wave: number;
  status: string;
  qualityScore?: number | null;
  personaId?: string | null;
}

export interface ScoreVM { feedbackScore: number; priceScore: number; blendedScore: number; rank: number | null }

/**
 * System score is shown ONLY when the inquiry is qualified (null otherwise → "Not
 * scored yet"). Feedback = the quality score; the full price/blended/rank breakdown
 * lives in the dossier (FE-08).
 */
export function scoreFor(record: InquiryRecord): ScoreVM | null {
  if (record.status !== InquiryStatus.Qualified) return null;
  const q = typeof record.qualityScore === 'number' ? record.qualityScore : 0;
  return { feedbackScore: q, priceScore: 0, blendedScore: q, rank: null };
}

/** Outreach variant from status + chain. A bounced message (550) wins over status. */
export function inquiryOutreachVariant({ status, chain }: { status: string; chain: ThreadMessageDto[] | null }): InquiryOutreachVariant {
  if (chain && chain.some((m) => m.status === MessageStatus.Bounced)) return InquiryOutreachVariant.Bounced;
  switch (status) {
    case InquiryStatus.Replied:
    case InquiryStatus.Qualified: return InquiryOutreachVariant.Replied;
    case InquiryStatus.Contacted:
    case InquiryStatus.Unresponsive: return InquiryOutreachVariant.Contacted; // thread open, still awaiting (long-poll)
    case InquiryStatus.Pending:
    case InquiryStatus.Researching: return InquiryOutreachVariant.Queued;
    case InquiryStatus.Failed: return InquiryOutreachVariant.Error;
    case InquiryStatus.Skipped: return InquiryOutreachVariant.Canceled;
    default: return InquiryOutreachVariant.Queued;
  }
}

/** Does this variant show the email chain (vs a status note)? */
export function showsChain(variant: InquiryOutreachVariant): boolean {
  return variant === InquiryOutreachVariant.Contacted || variant === InquiryOutreachVariant.Replied;
}

const NOTES: Record<string, string> = {
  [InquiryOutreachVariant.Queued]: 'Queued — not contacted yet.',
  [InquiryOutreachVariant.Bounced]: 'Bounced — the provider address rejected the message (550).',
  [InquiryOutreachVariant.Suspended]: 'Suspended by an operator.',
  [InquiryOutreachVariant.Canceled]: 'Canceled — the epic met its target before this wave was sent.',
  [InquiryOutreachVariant.Error]: 'Errored — outreach could not complete.',
};
export function outreachNote(variant: InquiryOutreachVariant): string {
  return NOTES[variant] ?? '';
}

/** History node colour follows the status (incl. negative endings). */
export function historyTone(status: string): StatusTone {
  return toneForInquiryStatus(status);
}

/** Tone for each outreach variant badge. */
export const OUTREACH_VARIANT_TONE: Record<InquiryOutreachVariant, StatusTone> = {
  [InquiryOutreachVariant.Replied]: StatusTone.Brand,
  [InquiryOutreachVariant.Contacted]: StatusTone.Info,
  [InquiryOutreachVariant.Queued]: StatusTone.Muted,
  [InquiryOutreachVariant.Bounced]: StatusTone.Danger,
  [InquiryOutreachVariant.Suspended]: StatusTone.Warn,
  [InquiryOutreachVariant.Canceled]: StatusTone.Subtle,
  [InquiryOutreachVariant.Error]: StatusTone.Danger,
};
