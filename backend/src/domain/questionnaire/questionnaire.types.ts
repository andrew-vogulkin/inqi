/** Input type of a questionnaire question. */
export const QuestionType = {
  Confirm: 'confirm',
  Text: 'text',
  Select: 'select',
} as const;
export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];

export interface QuestionnaireQuestion {
  id: string;
  prompt: string;
  type: QuestionType;
  options?: string[];
}
