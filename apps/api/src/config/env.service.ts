import { Inject, Injectable, Optional } from '@nestjs/common';
import { parseServerEnv, type ServerEnv } from '@mgc/contracts';

/**
 * Optional override for the environment source.
 *
 * Exists so integration tests can supply a specific environment without mutating
 * `process.env`, which is global state shared by every test in the run. A plain default
 * parameter cannot serve this purpose: NestJS reads constructor parameter types from
 * decorator metadata and would try to resolve a provider for `Object`.
 */
export const ENV_SOURCE = Symbol('ENV_SOURCE');

/**
 * Validated, frozen application configuration.
 *
 * Injected rather than read from `process.env` at the point of use, so that every
 * consumer gets typed access and tests can substitute configuration without mutating
 * global state. Validation happens exactly once, during module construction — if the
 * environment is wrong the process fails to start, loudly, with every problem listed.
 */
@Injectable()
export class EnvService {
  readonly values: Readonly<ServerEnv>;

  constructor(@Optional() @Inject(ENV_SOURCE) source?: NodeJS.ProcessEnv) {
    this.values = parseServerEnv(source ?? process.env);
  }

  get isProduction(): boolean {
    return this.values.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.values.NODE_ENV === 'development';
  }

  get isTest(): boolean {
    return this.values.NODE_ENV === 'test';
  }

  /** True once at least one AI provider credential is configured (Phase 5 onward). */
  get hasAiProvider(): boolean {
    const { ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY } = this.values;
    return Boolean(ANTHROPIC_API_KEY ?? OPENAI_API_KEY ?? GEMINI_API_KEY);
  }

  /** True once Razorpay credentials are configured (Phase 2 onward). */
  get hasPaymentProvider(): boolean {
    return Boolean(this.values.RAZORPAY_KEY_ID && this.values.RAZORPAY_KEY_SECRET);
  }
}
