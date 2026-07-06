/**
 * API error contract (convention #4). The codes + the code→message map are the
 * shared single source (`@inqi/shared`, API-03); this module re-exports them and
 * keeps the FE-runtime {@link ApiError} the api client throws.
 */
import { ErrorCode, friendlyMessage, statusToErrorCode } from '@inqi/shared';

export { ErrorCode, friendlyMessage };

/** @deprecated use {@link ErrorCode}. Kept as an alias so existing imports resolve. */
export const ApiErrorCode = ErrorCode;
export type ApiErrorCode = ErrorCode;

export interface ApiErrorArgs {
  code: string;
  message?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  httpStatus: number;
}

/** Typed error thrown by the api layer. Components/reducers branch on `.code`/`.httpStatus`. */
export class ApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;
  readonly httpStatus: number;

  constructor({ code, message, retryable, details, httpStatus }: ApiErrorArgs) {
    super(message ?? friendlyMessage(code));
    this.name = 'ApiError';
    this.code = code;
    this.retryable = retryable ?? false;
    this.details = details ?? {};
    this.httpStatus = httpStatus;
  }
}

/** Map a bare HTTP status (no envelope) to a stable code (delegates to the shared map). */
export function statusToCode(status: number): ErrorCode {
  return statusToErrorCode({ status });
}
