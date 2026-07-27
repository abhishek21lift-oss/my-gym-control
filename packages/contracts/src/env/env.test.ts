import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseServerEnv } from './index';

/** A complete, valid development environment — the baseline each case mutates. */
const validDevEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://mgc:pw@localhost:5432/my_gym_control?schema=public',
  DIRECT_URL: 'postgresql://mgc:pw@localhost:5432/my_gym_control?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_SECRET: 'a'.repeat(48),
  WEBAUTHN_RP_ID: 'localhost',
  WEBAUTHN_ORIGIN: 'http://localhost:3000',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_ACCESS_KEY_ID: 'mgc_local',
  STORAGE_SECRET_ACCESS_KEY: 'mgc_local_dev_secret',
  STORAGE_BUCKET_MEDIA: 'mgc-media',
  STORAGE_BUCKET_BODY: 'mgc-body-private',
});

const validProdEnv = (): NodeJS.ProcessEnv => ({
  ...validDevEnv(),
  NODE_ENV: 'production',
  API_URL: 'https://api.mygymcontrol.com',
  CORS_ORIGINS: 'https://app.mygymcontrol.com,https://mygymcontrol.com',
  WEBAUTHN_RP_ID: 'mygymcontrol.com',
  WEBAUTHN_ORIGIN: 'https://app.mygymcontrol.com',
  STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
});

/** Collects the field paths flagged by a failed parse. */
function issuePaths(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error.issues.map((i) => i.path.join('.'));
    }
    throw error;
  }
  throw new Error('expected parseServerEnv to throw, but it succeeded');
}

describe('parseServerEnv', () => {
  it('accepts a complete development environment and applies documented defaults', () => {
    const env = parseServerEnv(validDevEnv());

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.WEBAUTHN_RP_NAME).toBe('MY GYM CONTROL');
    expect(env.STORAGE_REGION).toBe('auto');
    expect(env.STORAGE_FORCE_PATH_STYLE).toBe(false);
  });

  it('parses CORS_ORIGINS into a trimmed list and drops empty entries', () => {
    const env = parseServerEnv({
      ...validDevEnv(),
      CORS_ORIGINS: 'http://localhost:3000, http://localhost:3001 ,,',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
  });

  it('defaults CORS_ORIGINS when the variable is absent entirely', () => {
    const env = parseServerEnv(validDevEnv());
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('normalises blank optional secrets to undefined rather than empty strings', () => {
    // .env files list every key; unset ones are present but empty. An empty string is
    // truthy enough to slip past a naive `if (key)` guard downstream.
    const env = parseServerEnv({ ...validDevEnv(), ANTHROPIC_API_KEY: '   ' });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('coerces API_PORT from its string form and rejects out-of-range ports', () => {
    expect(parseServerEnv({ ...validDevEnv(), API_PORT: '8080' }).API_PORT).toBe(8080);
    expect(issuePaths(() => parseServerEnv({ ...validDevEnv(), API_PORT: '70000' }))).toContain(
      'API_PORT',
    );
  });

  it('reports every problem at once instead of stopping at the first', () => {
    const paths = issuePaths(() =>
      parseServerEnv({
        ...validDevEnv(),
        DATABASE_URL: 'mysql://localhost:3306/gym',
        REDIS_URL: 'http://localhost:6379',
        AUTH_SECRET: 'too-short',
      }),
    );

    expect(paths).toEqual(expect.arrayContaining(['DATABASE_URL', 'REDIS_URL', 'AUTH_SECRET']));
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(issuePaths(() => parseServerEnv({ ...validDevEnv(), DATABASE_URL: 'not-a-url' }))).toContain(
      'DATABASE_URL',
    );
  });

  it('requires AUTH_SECRET to be at least 32 characters', () => {
    expect(issuePaths(() => parseServerEnv({ ...validDevEnv(), AUTH_SECRET: 'a'.repeat(31) }))).toContain(
      'AUTH_SECRET',
    );
  });

  it('freezes the result so configuration cannot be mutated at runtime', () => {
    const env = parseServerEnv(validDevEnv());
    expect(Object.isFrozen(env)).toBe(true);
  });

  describe('production invariants', () => {
    it('accepts a correctly configured production environment', () => {
      expect(() => parseServerEnv(validProdEnv())).not.toThrow();
    });

    it('rejects the placeholder AUTH_SECRET shipped in .env.example', () => {
      expect(
        issuePaths(() =>
          parseServerEnv({
            ...validProdEnv(),
            AUTH_SECRET: 'replace-me-with-a-long-random-string-at-least-32-chars',
          }),
        ),
      ).toContain('AUTH_SECRET');
    });

    it('rejects an insecure WebAuthn origin', () => {
      expect(
        issuePaths(() =>
          parseServerEnv({ ...validProdEnv(), WEBAUTHN_ORIGIN: 'http://app.mygymcontrol.com' }),
        ),
      ).toContain('WEBAUTHN_ORIGIN');
    });

    it('rejects wildcard and localhost CORS origins', () => {
      expect(issuePaths(() => parseServerEnv({ ...validProdEnv(), CORS_ORIGINS: '*' }))).toContain(
        'CORS_ORIGINS',
      );
      expect(
        issuePaths(() =>
          parseServerEnv({
            ...validProdEnv(),
            CORS_ORIGINS: 'https://app.mygymcontrol.com,http://localhost:3000',
          }),
        ),
      ).toContain('CORS_ORIGINS');
    });

    it('requires DIRECT_URL, since Prisma Migrate cannot run through pgbouncer', () => {
      const { DIRECT_URL: _omitted, ...withoutDirectUrl } = validProdEnv();
      expect(issuePaths(() => parseServerEnv(withoutDirectUrl))).toContain('DIRECT_URL');
    });

    it('applies none of the production invariants in development', () => {
      expect(() =>
        parseServerEnv({
          ...validDevEnv(),
          AUTH_SECRET: 'replace-me-with-a-long-random-string-at-least-32-chars',
          CORS_ORIGINS: 'http://localhost:3000',
        }),
      ).not.toThrow();
    });
  });
});
