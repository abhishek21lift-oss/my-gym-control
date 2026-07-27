import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError, ApiErrorCode } from '@mgc/contracts';
import type { Response } from 'express';
import { ZodError } from 'zod';
import type { AppRequest } from './app-request';
import { MissingTenantContextError } from '@mgc/db';

/**
 * Translates every thrown value into the single `ApiError` envelope defined in
 * @mgc/contracts, so clients have exactly one error shape to handle.
 *
 * The security-relevant half of this class is what it does *not* emit. Stack traces,
 * Prisma messages (which quote column names and constraint definitions) and internal
 * error text are logged server-side and replaced with a generic message in the
 * response. The `requestId` is the bridge: support can find the full detail in the logs
 * from the id the user reports.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly exposeInternals: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    // Partial: an exception thrown before RequestIdMiddleware runs — a malformed
    // request line, for instance — reaches this filter without a correlation id.
    const request = ctx.getRequest<Partial<AppRequest>>();
    const requestId = request.requestId ?? 'unknown';

    const { status, body } = this.toApiError(exception, requestId);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { requestId, path: request.url, method: request.method, err: exception },
        'Unhandled exception',
      );
    } else {
      this.logger.warn(
        { requestId, path: request.url, method: request.method, code: body.code },
        body.message,
      );
    }

    response.status(status).json(body);
  }

  private toApiError(
    exception: unknown,
    requestId: string,
  ): { status: number; body: ApiError } {
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        body: {
          code: 'VALIDATION_FAILED',
          message: 'The submitted data failed validation.',
          fields: exception.issues.map((issue) => ({
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
          requestId,
        },
      };
    }

    /**
     * A query reached the database with no tenant established. This is always a
     * server-side defect, never a client mistake, and it must never degrade into
     * returning unscoped data — so it is surfaced as a 500 and logged.
     */
    if (exception instanceof MissingTenantContextError) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        body: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
          requestId,
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        body: {
          code: this.codeForStatus(status),
          message: this.messageFrom(exception),
          requestId,
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'INTERNAL_ERROR',
        // Only ever leaked in development, and never in production, where the message
        // may quote a query, a constraint name or part of a row.
        message:
          this.exposeInternals && exception instanceof Error
            ? exception.message
            : 'An unexpected error occurred.',
        requestId,
      },
    };
  }

  private messageFrom(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object' && 'message' in response) {
      const { message } = response as { message: unknown };
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join('; ');
    }
    return exception.message;
  }

  private codeForStatus(status: number): ApiErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'VALIDATION_FAILED';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHENTICATED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      case HttpStatus.PAYMENT_REQUIRED:
        return 'PAYMENT_REQUIRED';
      case HttpStatus.BAD_GATEWAY:
      case HttpStatus.SERVICE_UNAVAILABLE:
      case HttpStatus.GATEWAY_TIMEOUT:
        return 'PROVIDER_UNAVAILABLE';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
