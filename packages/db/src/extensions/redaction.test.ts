import { describe, expect, it } from 'vitest';
import { __redactionInternals, redactForAudit } from './redaction';

const { isSensitiveKey, REDACTED } = __redactionInternals;

/**
 * The redaction policy is asserted, not trusted.
 *
 * The audit log is a complete before/after copy of every mutation, retained longer than
 * the rows it describes. If redaction silently stops covering a field, the result is a
 * long-lived plaintext copy of a credential in a table many people can read — and
 * nothing about the system would look broken. So the policy gets tests of its own.
 */

describe('isSensitiveKey', () => {
  it('matches credential-shaped names case-insensitively', () => {
    for (const key of [
      'password',
      'passwordHash',
      'Password',
      'totpSecret',
      'refreshTokenHash',
      'inviteTokenHash',
      'apiKey',
      'api_key',
      'STRIPE_SECRET',
      'publicKey',
      'credentialId',
      'sessionId',
      'cardNumber',
      'cvv',
    ]) {
      expect(isSensitiveKey(key), `${key} should be treated as sensitive`).toBe(true);
    }
  });

  it('covers field names that do not exist yet', () => {
    // Substring matching is what makes a field added in Phase 6 safe on the day it is
    // written, rather than on the day someone remembers to extend a list.
    expect(isSensitiveKey('razorpayWebhookSecret')).toBe(true);
    expect(isSensitiveKey('passwordResetTokenExpiry')).toBe(true);
    expect(isSensitiveKey('openAiApiKeyLastFour')).toBe(true);
  });

  it('leaves ordinary business fields alone', () => {
    for (const key of ['name', 'email', 'city', 'amount', 'createdAt', 'organizationId', 'code']) {
      expect(isSensitiveKey(key), `${key} should not be redacted`).toBe(false);
    }
  });
});

describe('redactForAudit', () => {
  it('replaces sensitive values while recording that the field was written', () => {
    const result = redactForAudit('OrganizationMember', {
      id: 'abc',
      inviteTokenHash: 'real-secret-value',
      status: 'INVITED',
    }) as Record<string, unknown>;

    expect(result['inviteTokenHash']).toBe(REDACTED);
    expect(result['status']).toBe('INVITED');
    expect(result['id']).toBe('abc');
    expect(JSON.stringify(result)).not.toContain('real-secret-value');
  });

  it('preserves null rather than masking it', () => {
    // "This field was cleared" and "this field holds something we are hiding" are
    // different auditable facts, and collapsing them loses information.
    const result = redactForAudit('User', { totpSecret: null }) as Record<string, unknown>;
    expect(result['totpSecret']).toBeNull();
  });

  it('recurses into nested writes', () => {
    const result = redactForAudit('User', {
      profile: { name: 'Aarav', security: { totpSecret: 'nested-secret' } },
    }) as Record<string, Record<string, Record<string, unknown>>>;

    expect(result['profile']?.['security']?.['totpSecret']).toBe(REDACTED);
    expect(JSON.stringify(result)).not.toContain('nested-secret');
  });

  it('recurses into arrays', () => {
    const result = redactForAudit('Role', {
      grants: [{ key: 'members.read' }, { apiKey: 'leaked' }],
    }) as { grants: Array<Record<string, unknown>> };

    expect(result.grants[0]?.['key']).toBe('members.read');
    expect(result.grants[1]?.['apiKey']).toBe(REDACTED);
  });

  it('redacts per-model private fields that are not credentials', () => {
    // Contact details are not secrets, but duplicating them into a long-retention table
    // extends their lifetime well past the row they came from.
    const result = redactForAudit('User', {
      fullName: 'Priya Nair',
      email: 'priya@example.com',
      phone: '+919876543210',
    }) as Record<string, unknown>;

    expect(result['fullName']).toBe('Priya Nair');
    expect(result['email']).toBe(REDACTED);
    expect(result['phone']).toBe(REDACTED);
  });

  it('only applies private-field rules to the model they belong to', () => {
    const result = redactForAudit('Branch', { email: 'gym@example.com' }) as Record<string, unknown>;
    // A branch's public contact email is business data, not personal data.
    expect(result['email']).toBe('gym@example.com');
  });

  it('serialises values JSON cannot represent', () => {
    const when = new Date('2026-07-28T10:00:00.000Z');
    const result = redactForAudit('Branch', {
      createdAt: when,
      counter: 42n,
      blob: new Uint8Array([1, 2, 3]),
    }) as Record<string, unknown>;

    expect(result['createdAt']).toBe('2026-07-28T10:00:00.000Z');
    expect(result['counter']).toBe('42');
    // Binary is described, not embedded — audit rows must not carry image payloads.
    expect(result['blob']).toBe('[binary:3b]');
  });

  it('caps recursion so a pathological structure cannot hang the mutation', () => {
    // The audit write happens inline with the mutation that triggered it, so an
    // unbounded walk would stall a user-facing request.
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic['self'] = cyclic;

    expect(() => redactForAudit('Branch', cyclic)).not.toThrow();
    expect(JSON.stringify(redactForAudit('Branch', cyclic))).toContain(REDACTED);
  });

  it('normalises null and undefined input to null', () => {
    expect(redactForAudit('Branch', null)).toBeNull();
    expect(redactForAudit('Branch', undefined)).toBeNull();
  });

  it('passes primitives through untouched', () => {
    expect(redactForAudit('Branch', 'MAIN')).toBe('MAIN');
    expect(redactForAudit('Branch', 7)).toBe(7);
    expect(redactForAudit('Branch', true)).toBe(true);
  });
});
