import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode } from './error-code.enum';
import { DomainError } from './domain-error';
import { ErrorEnvelopeDto } from './error-envelope.dto';

/** Map a Nest HTTP status to a stable {@link ErrorCode} for non-domain exceptions. */
const STATUS_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.ValidationFailed,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.Unauthorized,
  [HttpStatus.FORBIDDEN]: ErrorCode.Unauthorized,
  [HttpStatus.NOT_FOUND]: ErrorCode.NotFound,
};

/**
 * Global exception filter. Every error — typed {@link DomainError}, framework
 * {@link HttpException}, or unexpected throwable — is mapped to the stable
 * envelope `{ error: { code, message, retryable, details } }` so agents and the
 * orchestrator can reason about failures programmatically.
 *
 * (The `catch(exception, host)` signature is mandated by Nest's ExceptionFilter
 * contract, so it is exempt from the object-argument convention.)
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const envelope = this.toEnvelope(exception);
    const status = this.statusFor(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${req.method} ${req.url} -> ${status} ${envelope.error.code}: ${envelope.error.message}`, (exception as Error)?.stack);
    } else {
      this.logger.warn(`${req.method} ${req.url} -> ${status} ${envelope.error.code}: ${envelope.error.message}`);
    }

    res.status(status).json(envelope);
  }

  private statusFor(exception: unknown): number {
    if (exception instanceof DomainError) return exception.httpStatus;
    if (exception instanceof HttpException) return exception.getStatus();
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private toEnvelope(exception: unknown): ErrorEnvelopeDto {
    if (exception instanceof DomainError) {
      return { error: { code: exception.code, message: exception.message, retryable: exception.retryable, details: exception.details } };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? exception.message);
      return {
        error: {
          code: STATUS_CODE[status] ?? ErrorCode.Internal,
          message: Array.isArray(message) ? message.join('; ') : String(message),
          retryable: false,
          details: typeof body === 'object' ? (body as Record<string, unknown>) : {},
        },
      };
    }

    return {
      error: {
        code: ErrorCode.Internal,
        message: 'Internal server error',
        retryable: false,
        details: {},
      },
    };
  }
}
