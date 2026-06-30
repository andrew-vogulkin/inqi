import { StatusTone } from './enums';

/** FE-04 — the new-inquiry suggestion hint tags (decorative; Photo upload is disabled). */
export const SuggestionTag = {
  Service: 'service',
  NearMe: 'near_me',
  BudgetSet: 'budget_set',
  FlexibleTiming: 'flexible_timing',
  PhotoUpload: 'photo_upload',
} as const;
export type SuggestionTag = (typeof SuggestionTag)[keyof typeof SuggestionTag];

export interface SuggestionTagDef { tag: SuggestionTag; label: string; tone: StatusTone; soon?: boolean }

export const SUGGESTION_TAGS: SuggestionTagDef[] = [
  { tag: SuggestionTag.Service, label: 'Service', tone: StatusTone.Brand },
  { tag: SuggestionTag.NearMe, label: 'Near me', tone: StatusTone.Info },
  { tag: SuggestionTag.BudgetSet, label: 'Budget set', tone: StatusTone.Warn },
  { tag: SuggestionTag.FlexibleTiming, label: 'Flexible timing', tone: StatusTone.Muted },
  { tag: SuggestionTag.PhotoUpload, label: 'Photo upload', tone: StatusTone.Subtle, soon: true },
];
