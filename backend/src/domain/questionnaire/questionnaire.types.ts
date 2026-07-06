/** Input type of a questionnaire question. */
export const QuestionType = {
  Confirm: 'confirm',
  Text: 'text',
  Select: 'select',          // pick one option
  MultiSelect: 'multiselect', // pick any number of options (wire value matches the FE FieldType)
} as const;
export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];

export interface QuestionnaireQuestion {
  id: string;
  prompt: string;
  type: QuestionType;
  options?: string[];
}
