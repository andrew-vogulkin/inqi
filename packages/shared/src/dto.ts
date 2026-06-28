import type { OutreachStrategy } from './workflow.js';

export interface CreateInquiryDto {
  customerEmail: string;
  /** Free-text of what they're looking for (item/service/rental/org/goods/trade). */
  rawRequest: string;
  geo?: { lat: number; lng: number; label?: string };
  budgetMin?: number;
  budgetMax?: number;
  deadline?: string; // ISO
}

export interface QuestionnaireAnswersDto {
  confirmedSubject: boolean;       // customer confirms the item/service is correct
  answers: Record<string, string>;
}

export interface EpicConfig {
  strategy: OutreachStrategy;
  targetQualifiedOptions: number;  // stop early once reached
}
