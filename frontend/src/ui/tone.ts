import { ReportState, InquiryStatus } from '@inqi/shared';
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

/** Report state → tone (status→color enum, FE styling spec). */
export function toneForReportState(state: string): StatusTone {
  switch (state) {
    case ReportState.REPORT_DELIVERED: return StatusTone.Brand;
    case ReportState.DENIED:
    case ReportState.DROPPED:
    case ReportState.FAILED: return StatusTone.Danger;
    case ReportState.CANCELLED:
    case ReportState.ON_HOLD: return StatusTone.Warn;
    default: return StatusTone.Info; // in-flight processing
  }
}

/** Inquiry status → tone. */
export function toneForInquiryStatus(status: string): StatusTone {
  switch (status) {
    case InquiryStatus.Qualified: return StatusTone.Brand;
    case InquiryStatus.Contacted:
    case InquiryStatus.Replied:
    case InquiryStatus.Researching: return StatusTone.Info;
    case InquiryStatus.Unresponsive: return StatusTone.Warn; // silent, but the thread stays open
    case InquiryStatus.Failed: return StatusTone.Danger;
    case InquiryStatus.Skipped: return StatusTone.Subtle;
    default: return StatusTone.Muted; // pending / queued
  }
}
