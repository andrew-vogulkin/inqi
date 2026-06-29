import { SubtaskStatus, MessageStatus } from '@inqi/shared';
import { SubtaskOutreachVariant, StatusTone } from './enums';
import { toneForSubtaskStatus } from '../ui/tone';
import { ThreadMessageDto } from '../api/types';

/** A subtask record as held on the admin board (FE-10 → FE-11). */
export interface SubtaskRecord {
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
 * System score is shown ONLY when the subtask is qualified (null otherwise → "Not
 * scored yet"). Feedback = the quality score; the full price/blended/rank breakdown
 * lives in the dossier (FE-08).
 */
export function scoreFor(record: SubtaskRecord): ScoreVM | null {
  if (record.status !== SubtaskStatus.Qualified) return null;
  const q = typeof record.qualityScore === 'number' ? record.qualityScore : 0;
  return { feedbackScore: q, priceScore: 0, blendedScore: q, rank: null };
}

/** Outreach variant from status + chain. A bounced message (550) wins over status. */
export function subtaskOutreachVariant({ status, chain }: { status: string; chain: ThreadMessageDto[] | null }): SubtaskOutreachVariant {
  if (chain && chain.some((m) => m.status === MessageStatus.Bounced)) return SubtaskOutreachVariant.Bounced;
  switch (status) {
    case SubtaskStatus.Replied:
    case SubtaskStatus.Qualified: return SubtaskOutreachVariant.Replied;
    case SubtaskStatus.Contacted: return SubtaskOutreachVariant.Contacted;
    case SubtaskStatus.Pending:
    case SubtaskStatus.Researching: return SubtaskOutreachVariant.Queued;
    case SubtaskStatus.Failed: return SubtaskOutreachVariant.Error;
    case SubtaskStatus.Skipped: return SubtaskOutreachVariant.Canceled;
    default: return SubtaskOutreachVariant.Queued;
  }
}

/** Does this variant show the email chain (vs a status note)? */
export function showsChain(variant: SubtaskOutreachVariant): boolean {
  return variant === SubtaskOutreachVariant.Contacted || variant === SubtaskOutreachVariant.Replied;
}

const NOTES: Record<string, string> = {
  [SubtaskOutreachVariant.Queued]: 'Queued — not contacted yet.',
  [SubtaskOutreachVariant.Bounced]: 'Bounced — the provider address rejected the message (550).',
  [SubtaskOutreachVariant.Suspended]: 'Suspended by an operator.',
  [SubtaskOutreachVariant.Canceled]: 'Canceled — the epic met its target before this wave was sent.',
  [SubtaskOutreachVariant.Error]: 'Errored — outreach could not complete.',
};
export function outreachNote(variant: SubtaskOutreachVariant): string {
  return NOTES[variant] ?? '';
}

/** History node colour follows the status (incl. negative endings). */
export function historyTone(status: string): StatusTone {
  return toneForSubtaskStatus(status);
}

/** Tone for each outreach variant badge. */
export const OUTREACH_VARIANT_TONE: Record<SubtaskOutreachVariant, StatusTone> = {
  [SubtaskOutreachVariant.Replied]: StatusTone.Brand,
  [SubtaskOutreachVariant.Contacted]: StatusTone.Info,
  [SubtaskOutreachVariant.Queued]: StatusTone.Muted,
  [SubtaskOutreachVariant.Bounced]: StatusTone.Danger,
  [SubtaskOutreachVariant.Suspended]: StatusTone.Warn,
  [SubtaskOutreachVariant.Canceled]: StatusTone.Subtle,
  [SubtaskOutreachVariant.Error]: StatusTone.Danger,
};
