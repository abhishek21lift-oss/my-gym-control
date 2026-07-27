import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates a handler argument against a Zod schema from @mgc/contracts.
 *
 * Chosen over `class-validator` deliberately: class-validator requires a second,
 * decorator-annotated class per DTO that cannot be shared with the browser, so the API
 * and the React forms end up with two independent definitions of the same shape which
 * drift apart. A Zod schema is one definition that validates on both sides and infers
 * the TypeScript type — see docs/ARCHITECTURE.md §6.
 *
 * The parsed (and therefore coerced, defaulted and stripped) value is returned, so
 * handlers receive exactly the declared type and never an unvalidated passthrough of
 * whatever the client sent.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    // Throws ZodError, which AllExceptionsFilter renders as VALIDATION_FAILED with
    // per-field paths the client can attach directly to form inputs.
    return this.schema.parse(value);
  }
}

/** Convenience factory: `@Body(zodPipe(createMemberSchema)) body: CreateMember`. */
export const zodPipe = <T>(schema: ZodType<T>): ZodValidationPipe<T> =>
  new ZodValidationPipe(schema);
