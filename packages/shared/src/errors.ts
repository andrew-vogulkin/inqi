/**
 * API-03 — the canonical error contract. The wire envelope is
 * `{ error: { code, message, retryable, details } }`; `code` is an {@link ErrorCode}.
 * This is the single source the FE api layer (API-01) and the BE error filter map
 * against — kept in lockstep with the backend `ErrorCode` (same string values) plus
 * the client-only `NETWORK` (a request that never reached the server).
 */
export const ErrorCode = {
  ValidationFailed: 'VALIDATION_FAILED',
  NotFound: 'NOT_FOUND',
  Unauthorized: 'UNAUTHORIZED',
  Internal: 'INTERNAL',
  // auth
  AuthRequired: 'AUTH_REQUIRED',
  AuthForbidden: 'AUTH_FORBIDDEN',
  AuthTokenExpired: 'AUTH_TOKEN_EXPIRED',
  AuthInvalidToken: 'AUTH_INVALID_TOKEN',
  AuthInvalidCode: 'AUTH_INVALID_CODE',
  // domain not-found / state
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
  // infra
  AiRequestFailed: 'AI_REQUEST_FAILED',
  AiInvalidJson: 'AI_INVALID_JSON',
  MailSendFailed: 'MAIL_SEND_FAILED',
  WebhookSignatureInvalid: 'WEBHOOK_SIGNATURE_INVALID',
  // client-only (the request never reached the server)
  Network: 'NETWORK',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Friendly, user-facing message for every code (total over {@link ErrorCode}). */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.ValidationFailed]: 'Some details look off — please check and try again.',
  [ErrorCode.NotFound]: "We couldn't find that.",
  [ErrorCode.Unauthorized]: 'Please sign in to continue.',
  [ErrorCode.Internal]: 'Something went wrong on our end. Please try again.',
  [ErrorCode.AuthRequired]: 'Please sign in to continue.',
  [ErrorCode.AuthForbidden]: 'This area is for operators.',
  [ErrorCode.AuthTokenExpired]: 'Your session expired — please sign in again.',
  [ErrorCode.AuthInvalidToken]: 'Your session is invalid — please sign in again.',
  [ErrorCode.AuthInvalidCode]: 'That verification code is incorrect — check the 6 digits and try again.',
  [ErrorCode.ReportNotFound]: "We can't find that report.",
  [ErrorCode.InquiryNotFound]: "We can't find that inquiry.",
  [ErrorCode.QuestionnaireNotFound]: 'This link is invalid or has expired.',
  [ErrorCode.QuestionnaireExpired]: 'This link has expired.',
  [ErrorCode.QuestionnaireNotConfirmed]: 'Please confirm the subject before continuing.',
  [ErrorCode.InquiryThreadNotFound]: "We couldn't find that conversation.",
  [ErrorCode.SnapshotNotFound]: 'This report link is invalid or has expired.',
  [ErrorCode.NoActiveWorkflow]: 'No active workflow is configured.',
  [ErrorCode.InvalidWorkflowTransition]: "That workflow change isn't allowed.",
  [ErrorCode.WorkflowGuardBlocked]: 'A workflow guard blocked that action.',
  [ErrorCode.OutreachBlockedByCompliance]: 'Outreach was blocked by compliance.',
  [ErrorCode.CustomerNotFound]: "We couldn't find that account.",
  [ErrorCode.CreditsInsufficient]: "You're out of credits. Ask an admin to top up your balance.",
  [ErrorCode.AiRequestFailed]: 'The model is busy right now. Please try again.',
  [ErrorCode.AiInvalidJson]: 'The model returned an unexpected response. Please try again.',
  [ErrorCode.MailSendFailed]: "We couldn't send that email. Please try again.",
  [ErrorCode.WebhookSignatureInvalid]: 'This request could not be verified.',
  [ErrorCode.Network]: "Can't reach inqi right now — check your connection.",
};

/** Friendly message for a code (falls back to a generic line for unknown codes). */
export function friendlyMessage(code: string): string {
  return ERROR_MESSAGES[code as ErrorCode] ?? 'Something went wrong. Please try again.';
}

/** Map a bare HTTP status (no envelope) to a stable {@link ErrorCode}. */
export function statusToErrorCode({ status }: { status: number }): ErrorCode {
  switch (status) {
    case 401: return ErrorCode.Unauthorized;
    case 403: return ErrorCode.AuthForbidden;
    case 404: return ErrorCode.NotFound;
    case 402: return ErrorCode.CreditsInsufficient;
    case 400: return ErrorCode.ValidationFailed;
    default: return ErrorCode.Internal;
  }
}
