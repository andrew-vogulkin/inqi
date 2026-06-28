import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-code.enum';

export interface DomainErrorArgs {
  code: ErrorCode;
  message: string;
  /** HTTP status the global filter responds with. */
  httpStatus?: number;
  /** Whether the orchestrator may safely retry the operation that failed. */
  retryable?: boolean;
  /** Structured context for agents/operators (never secrets). */
  details?: Record<string, unknown>;
}

/**
 * Base class for every typed domain exception. The global exception filter maps
 * these to the stable envelope `{ error: { code, message, retryable, details } }`.
 * Never throw bare strings or untyped errors out of services.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor({ code, message, httpStatus, retryable, details }: DomainErrorArgs) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus ?? HttpStatus.BAD_REQUEST;
    this.retryable = retryable ?? false;
    this.details = details ?? {};
  }
}

/** A requested resource does not exist (HTTP 404). */
export class NotFoundError extends DomainError {
  constructor({ code, message, details }: Omit<DomainErrorArgs, 'httpStatus' | 'retryable'>) {
    super({ code, message, httpStatus: HttpStatus.NOT_FOUND, retryable: false, details });
  }
}

/** The caller is not authenticated (HTTP 401). Defaults to the AUTH_REQUIRED code. */
export class UnauthorizedError extends DomainError {
  constructor({ code = ErrorCode.AuthRequired, message, details }: Omit<DomainErrorArgs, 'httpStatus' | 'retryable' | 'code'> & { code?: ErrorCode }) {
    super({ code, message, httpStatus: HttpStatus.UNAUTHORIZED, retryable: false, details });
  }
}

/** The caller is authenticated but lacks the required role/ownership (HTTP 403). */
export class ForbiddenError extends DomainError {
  constructor({ code = ErrorCode.AuthForbidden, message, details }: Omit<DomainErrorArgs, 'httpStatus' | 'retryable' | 'code'> & { code?: ErrorCode }) {
    super({ code, message, httpStatus: HttpStatus.FORBIDDEN, retryable: false, details });
  }
}

/** A request conflicts with current state — e.g. an invalid workflow transition (HTTP 409). */
export class ConflictError extends DomainError {
  constructor({ code, message, details }: Omit<DomainErrorArgs, 'httpStatus' | 'retryable'>) {
    super({ code, message, httpStatus: HttpStatus.CONFLICT, retryable: false, details });
  }
}

/** An outbound message/questionnaire was blocked by the compliance gate (HTTP 422). */
export class ComplianceBlockedError extends DomainError {
  constructor({ message, details }: Omit<DomainErrorArgs, 'code' | 'httpStatus' | 'retryable'>) {
    super({
      code: ErrorCode.OutreachBlockedByCompliance,
      message,
      httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
      retryable: false,
      details,
    });
  }
}

/**
 * A failure in an upstream dependency (AI provider, mail provider, IO). Defaults
 * to retryable so the orchestrator can re-enqueue; pass `retryable: false` for
 * permanent failures (e.g. malformed model output that won't self-correct).
 */
export class UpstreamError extends DomainError {
  constructor({ code, message, retryable, details }: Omit<DomainErrorArgs, 'httpStatus'>) {
    super({ code, message, httpStatus: HttpStatus.BAD_GATEWAY, retryable: retryable ?? true, details });
  }
}
