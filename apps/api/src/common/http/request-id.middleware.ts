import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { AppRequest } from './app-request';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Assigns every request a correlation id, echoed back in the response header.
 *
 * An inbound `x-request-id` from a trusted upstream proxy is honoured so a trace
 * survives the hop; anything malformed or oversized is replaced rather than trusted,
 * since this value ends up in log lines and audit rows where an attacker-controlled
 * string could otherwise be used to forge or split entries.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware<AppRequest, Response> {
  private static readonly SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

  use(req: AppRequest, res: Response, next: NextFunction): void {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;

    req.requestId =
      candidate && RequestIdMiddleware.SAFE_ID.test(candidate) ? candidate : randomUUID();

    res.setHeader(REQUEST_ID_HEADER, req.requestId);
    next();
  }
}
