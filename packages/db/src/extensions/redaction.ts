/**
 * Field redaction for audit records.
 *
 * The audit log is a complete before/after history of every mutation, which makes it —
 * by construction — a second copy of every value in the database. Without redaction it
 * would also be a second copy of every *secret*: token hashes, TOTP seeds, invite
 * tokens. Those would then sit in a table that is deliberately append-only, retained
 * far longer than the rows it describes, and readable by anyone with audit access.
 *
 * So the audit trail records that a field changed without recording what it changed to.
 * "Someone rotated this token at 14:02" is the useful fact; the token value is not.
 */

const REDACTED = '[redacted]';

/**
 * Field names that must never be written to an audit row, matched case-insensitively
 * as substrings.
 *
 * Substring matching is intentional: it means a future `passwordResetTokenHash` or
 * `stripeSecretKey` is covered on the day it is added, without anyone remembering to
 * extend this list. Over-redacting an innocuous field is a cosmetic problem;
 * under-redacting a credential is an incident.
 */
const SENSITIVE_FRAGMENTS = [
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'publickey',
  'public_key',
  'credential',
  'totp',
  'refresh',
  'sessionid',
  'session_id',
  'cvv',
  'cardnumber',
  'card_number',
] as const;

function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase();
  return SENSITIVE_FRAGMENTS.some((fragment) => normalised.includes(fragment));
}

/**
 * Per-model fields that are not credentials but are personal enough that the audit log
 * should not duplicate them.
 *
 * Health notes and body imagery are special-category data under India's DPDP Act. An
 * audit trail needs to show that a member's medical notes were edited, by whom, and
 * when — it does not need to keep a permanent copy of the notes themselves, and keeping
 * one would extend the retention of the most sensitive data in the system to the
 * lifetime of the audit table.
 */
const MODEL_PRIVATE_FIELDS: Record<string, readonly string[]> = {
  User: ['phone', 'email'],
  ConsentRecord: ['ipAddress', 'userAgent'],
};

export type AuditPayload = Record<string, unknown> | null;

/**
 * Produces an audit-safe copy of a row.
 *
 * Recurses into nested objects and arrays, because Prisma writes accept nested
 * structures and a top-level-only scan would let a secret through inside a nested
 * create. Depth is capped so a cyclic or pathological structure cannot hang the
 * mutation that triggered the audit write.
 */
export function redactForAudit(
  model: string,
  value: unknown,
  depth = 0,
): AuditPayload | unknown {
  if (depth > 6) return REDACTED;
  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    return value.map((entry) => redactForAudit(model, entry, depth + 1));
  }

  // Dates and Buffers serialise fine but must not be walked as plain objects.
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `[binary:${value.byteLength}b]`;
  if (typeof value === 'bigint') return value.toString();

  if (typeof value !== 'object') return value;

  const privateFields = MODEL_PRIVATE_FIELDS[model] ?? [];
  const output: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key) || privateFields.includes(key)) {
      // Recording presence rather than absence: a reviewer can see the field was
      // written, which is the auditable fact.
      output[key] = entry === null ? null : REDACTED;
      continue;
    }
    output[key] = redactForAudit(model, entry, depth + 1);
  }

  return output;
}

/** Exposed for the test suite, which asserts the policy rather than trusting it. */
export const __redactionInternals = { isSensitiveKey, SENSITIVE_FRAGMENTS, REDACTED };
