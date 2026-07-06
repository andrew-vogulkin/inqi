import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorEnvelopeDto } from './error-envelope.dto';

/** What each documented error status means on this API (all carry the ErrorEnvelope). */
const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Validation failed — body/params do not satisfy the contract (code VALIDATION_FAILED).',
  401: 'Not authenticated — missing/expired session, invalid webhook signature, or a wrong sign-in code (codes AUTH_*, WEBHOOK_SIGNATURE_INVALID).',
  402: 'Insufficient credits (code CREDITS_INSUFFICIENT — details carry required + balance).',
  403: 'Authenticated but not allowed — operator-only surface (code AUTH_FORBIDDEN).',
  404: 'Not found — includes ownership-scoped reads, which 404 for non-owners rather than leaking existence (codes *_NOT_FOUND, QUESTIONNAIRE_EXPIRED).',
  409: 'Conflict — the workflow/state does not allow this action right now (codes INVALID_WORKFLOW_TRANSITION, WORKFLOW_GUARD_BLOCKED).',
  422: 'Blocked by the compliance gate (code OUTREACH_BLOCKED_BY_COMPLIANCE).',
};

/**
 * Document the error statuses an endpoint can actually return. Every error leaves
 * the API as the stable `{ error: { code, message, retryable, details } }` envelope
 * (machine-readable `code` — agents decide retry vs. deny without parsing prose).
 */
export function ApiStandardErrors(...statuses: number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({ status, description: ERROR_DESCRIPTIONS[status] ?? 'Error envelope.', type: ErrorEnvelopeDto }),
    ),
  );
}
