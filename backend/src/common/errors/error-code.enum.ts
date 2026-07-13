/**
 * Stable, machine-readable error codes. Every error that leaves the API carries
 * one of these in the `{ error: { code, ... } }` envelope so the orchestrator
 * and agents can reason about failures (retry vs. deny) without parsing prose.
 */
export const ErrorCode = {
  // generic / framework
  ValidationFailed: 'VALIDATION_FAILED',
  NotFound: 'NOT_FOUND',
  Unauthorized: 'UNAUTHORIZED',
  Internal: 'INTERNAL',

  // auth (HP-10)
  AuthRequired: 'AUTH_REQUIRED',
  AuthForbidden: 'AUTH_FORBIDDEN',
  AuthTokenExpired: 'AUTH_TOKEN_EXPIRED',
  AuthInvalidToken: 'AUTH_INVALID_TOKEN',
  AuthInvalidCode: 'AUTH_INVALID_CODE', // two-step email sign-in: the MFA code did not match
  AccountSuspended: 'ACCOUNT_SUSPENDED', // HP-25: the account is suspended (sign-in refused / session rejected)

  // domain
  ReportNotFound: 'REPORT_NOT_FOUND',
  InquiryNotFound: 'INQUIRY_NOT_FOUND',
  QuestionnaireNotFound: 'QUESTIONNAIRE_NOT_FOUND',
  QuestionnaireExpired: 'QUESTIONNAIRE_EXPIRED',
  QuestionnaireNotConfirmed: 'QUESTIONNAIRE_NOT_CONFIRMED',
  InquiryThreadNotFound: 'INQUIRY_THREAD_NOT_FOUND',
  SnapshotNotFound: 'SNAPSHOT_NOT_FOUND',
  NoActiveWorkflow: 'NO_ACTIVE_WORKFLOW',
  InvalidWorkflowTransition: 'INVALID_WORKFLOW_TRANSITION',
  WorkflowGuardBlocked: 'WORKFLOW_GUARD_BLOCKED',
  OutreachBlockedByCompliance: 'OUTREACH_BLOCKED_BY_COMPLIANCE',

  // credits (HP-19)
  CustomerNotFound: 'CUSTOMER_NOT_FOUND',
  CreditsInsufficient: 'CREDITS_INSUFFICIENT',

  // upstream / IO (wrapped so the orchestrator can decide retry vs. deny)
  AiRequestFailed: 'AI_REQUEST_FAILED',
  AiInvalidJson: 'AI_INVALID_JSON',
  MailSendFailed: 'MAIL_SEND_FAILED',
  WebhookSignatureInvalid: 'WEBHOOK_SIGNATURE_INVALID',
  WebSearchFailed: 'WEB_SEARCH_FAILED',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
