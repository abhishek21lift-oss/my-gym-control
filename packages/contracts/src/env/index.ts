import { z } from 'zod';

/**
 * Environment validation.
 *
 * Every process validates its environment once, at boot, and refuses to start if
 * anything is missing or malformed. The alternative — reading `process.env.X` at the
 * point of use — turns a deployment mistake into an intermittent runtime failure
 * discovered by a user rather than by the deploy.
 */

const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

/**
 * Comma-separated string -> trimmed, non-empty string array.
 *
 * The default is applied to the raw string before the transform runs. In Zod 4
 * `.default()` sits on the *output* side of a pipe, so chaining it after `.transform()`
 * would require handing it an already-split array — which is both awkward and easy to
 * let drift out of sync with the `.env.example` value.
 */
const csvList = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

const postgresUrl = z
  .url()
  .refine((u) => u.startsWith('postgres://') || u.startsWith('postgresql://'), {
    message: 'must be a postgres:// or postgresql:// connection string',
  });

/**
 * Optional-until-required: a credential that may legitimately be blank during early
 * phases (Supabase before Phase 1, AI keys before Phase 5) but must be non-empty once
 * the feature that consumes it is switched on. Empty strings normalise to `undefined`
 * so that `.env` files can list the key without setting it.
 */
const optionalSecret = z
  .string()
  .transform((v) => (v.trim() === '' ? undefined : v.trim()))
  .optional();

/** Like `optionalSecret` but validates as a URL when a value is supplied. */
const optionalUrl = z
  .string()
  .transform((v) => (v.trim() === '' ? undefined : v.trim()))
  .pipe(z.url().optional());

export const serverEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,

    // --- API ---
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    API_URL: z.url().default('http://localhost:4000'),
    CORS_ORIGINS: csvList('http://localhost:3000'),

    // --- Data ---
    DATABASE_URL: postgresUrl,
    DIRECT_URL: postgresUrl.optional(),
    // Optional until the worker/queue (Phase 5) and rate limiting actually consume it.
    // Nothing in Phase 1 connects to Redis, so a blank value must not block a deploy.
    REDIS_URL: z
      .string()
      .transform((v) => (v.trim() === '' ? undefined : v.trim()))
      .pipe(
        z
          .url()
          .refine(
            (u) => u.startsWith('redis://') || u.startsWith('rediss://'),
            'must be a redis:// or rediss:// URL',
          )
          .optional(),
      ),

    // --- Auth ---
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
    WEBAUTHN_RP_ID: z.string().min(1),
    WEBAUTHN_RP_NAME: z.string().min(1).default('MY GYM CONTROL'),
    WEBAUTHN_ORIGIN: z.url(),

    // --- Supabase (Phase 1) ---
    SUPABASE_URL: optionalSecret,
    SUPABASE_ANON_KEY: optionalSecret,
    SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
    SUPABASE_JWT_ISSUER: optionalSecret,

    // --- Storage (Phase 6 consumes this; nothing in Phase 1 uploads or reads media) ---
    STORAGE_ENDPOINT: optionalUrl,
    STORAGE_REGION: z.string().min(1).default('auto'),
    STORAGE_ACCESS_KEY_ID: optionalSecret,
    STORAGE_SECRET_ACCESS_KEY: optionalSecret,
    STORAGE_BUCKET_MEDIA: z.string().min(1).default('mgc-media'),
    STORAGE_BUCKET_BODY: z.string().min(1).default('mgc-body-private'),
    STORAGE_FORCE_PATH_STYLE: z.stringbool().default(false),

    // --- Payments (Phase 2) ---
    RAZORPAY_KEY_ID: optionalSecret,
    RAZORPAY_KEY_SECRET: optionalSecret,
    RAZORPAY_WEBHOOK_SECRET: optionalSecret,

    // --- AI (Phase 5) ---
    ANTHROPIC_API_KEY: optionalSecret,
    OPENAI_API_KEY: optionalSecret,
    GEMINI_API_KEY: optionalSecret,
  })
  /**
   * Production-only invariants. These are the mistakes that are harmless locally and
   * severe in production, so they are checked where they matter instead of being
   * blanket-required everywhere and encouraging developers to paste fake values.
   */
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    if (env.AUTH_SECRET.includes('replace-me')) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_SECRET'],
        message: 'AUTH_SECRET still holds the example placeholder value',
      });
    }

    if (env.WEBAUTHN_ORIGIN.startsWith('http://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEBAUTHN_ORIGIN'],
        message: 'WebAuthn requires a secure origin (https) outside development',
      });
    }

    for (const origin of env.CORS_ORIGINS) {
      if (origin === '*' || origin.includes('localhost')) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: `refusing wildcard or localhost origin "${origin}" in production`,
        });
      }
    }

    if (!env.DIRECT_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DIRECT_URL'],
        message: 'DIRECT_URL is required in production — migrations cannot run through pgbouncer',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Client environment. Only `NEXT_PUBLIC_*` values belong here, and everything in it is
 * shipped to the browser in plaintext. Keeping it in a separate schema makes the
 * public/secret boundary explicit rather than a naming convention people remember.
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SITE_URL: z.url(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: readonly z.core.$ZodIssue[]) {
    const detail = issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    super(`Invalid environment configuration:\n${detail}\n`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Parses and freezes an environment object. Throws `EnvValidationError` listing every
 * problem at once — reporting only the first failure means a misconfigured deploy takes
 * as many round trips to fix as it has mistakes.
 */
export function parseServerEnv(source: NodeJS.ProcessEnv = process.env): Readonly<ServerEnv> {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) throw new EnvValidationError(result.error.issues);
  return Object.freeze(result.data);
}

export function parseClientEnv(source: Record<string, string | undefined>): Readonly<ClientEnv> {
  const result = clientEnvSchema.safeParse(source);
  if (!result.success) throw new EnvValidationError(result.error.issues);
  return Object.freeze(result.data);
}
