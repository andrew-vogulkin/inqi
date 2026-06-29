import { InquiryState, SubtaskStatus } from '@inqi/shared';
import { StatusTone } from '../conventions/enums';
import { color } from '../theme/tokens';

export interface ToneColors { fg: string; bg: string; border: string }

/** StatusTone → token colours (fg / tint bg / border). Components never hard-code hex. */
export const toneColors: Record<StatusTone, ToneColors> = {
  [StatusTone.Brand]: { fg: color.brand, bg: color.brandTint, border: color.brand },
  [StatusTone.Info]: { fg: color.info, bg: color.infoTint, border: color.info },
  [StatusTone.Warn]: { fg: color.warn, bg: color.warnTint, border: color.warn },
  [StatusTone.Danger]: { fg: color.danger, bg: color.dangerTint, border: color.danger },
  [StatusTone.Muted]: { fg: color.muted, bg: color.surfaceSunken, border: color.line },
  [StatusTone.Subtle]: { fg: color.subtle, bg: color.surfaceSunken, border: color.line },
};

/** Inquiry state → tone (status→color enum, FE styling spec). */
export function toneForInquiryState(state: string): StatusTone {
  switch (state) {
    case InquiryState.REPORT_DELIVERED: return StatusTone.Brand;
    case InquiryState.DENIED:
    case InquiryState.DROPPED:
    case InquiryState.FAILED: return StatusTone.Danger;
    case InquiryState.CANCELLED:
    case InquiryState.ON_HOLD: return StatusTone.Warn;
    default: return StatusTone.Info; // in-flight processing
  }
}

/** Subtask status → tone. */
export function toneForSubtaskStatus(status: string): StatusTone {
  switch (status) {
    case SubtaskStatus.Qualified: return StatusTone.Brand;
    case SubtaskStatus.Contacted:
    case SubtaskStatus.Replied:
    case SubtaskStatus.Researching: return StatusTone.Info;
    case SubtaskStatus.Failed: return StatusTone.Danger;
    case SubtaskStatus.Skipped: return StatusTone.Subtle;
    default: return StatusTone.Muted; // pending / queued
  }
}
