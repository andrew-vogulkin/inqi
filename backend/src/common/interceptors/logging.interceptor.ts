import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Request-logging interceptor: logs method, path and latency for every HTTP
 * request. (The `intercept(context, next)` signature is mandated by Nest's
 * NestInterceptor contract, so it is exempt from the object-argument convention.)
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const startedAt = Date.now();
    return next.handle().pipe(
      tap(() => this.logger.log(`${req.method} ${req.url} (${Date.now() - startedAt}ms)`)),
    );
  }
}
