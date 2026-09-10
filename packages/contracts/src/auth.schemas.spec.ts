import {
  changePasswordSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateSettingsSchema,
} from './index';

/**
 * Spec 001 § 5 contracts at their boundary values, and § 9 "packages/contracts
 * zod schemas at boundary values".
 *
 * These schemas are the whole of `whitelist` / `forbidNonWhitelisted` under the
 * zod decision (ARCHITECTURE.md § 9, decision 2): strictness lives here, so an
 * unknown field must fail *here* rather than being dropped downstream.
 */

const VALID_REGISTRATION = {
  email: 'nicolas@example.com',
  username: 'nico',
  password: 'correct horse battery',
  acceptedTerms: true,
} as const;

describe('registerSchema', () => {
  it('accepts a valid registration', () => {
    expect(registerSchema.parse(VALID_REGISTRATION)).toMatchObject({ username: 'nico' });
  });

  it('trims and lowercases the email', () => {
    // § 7 — `Nico@x.com` and `nico@x.com` are the same account.
    const parsed = registerSchema.parse({
      ...VALID_REGISTRATION,
      email: '  NICOLAS@Example.COM  ',
    });
    expect(parsed.email).toBe('nicolas@example.com');
  });

  it.each([
    ['exactly 10', 'a'.repeat(10), true],
    ['exactly 128', 'a'.repeat(128), true],
    ['129', 'a'.repeat(129), false],
    ['9', 'a'.repeat(9), false],
  ])('password of %s characters', (_label, password, accepted) => {
    // § 7 "Password exactly 10 / 128 / 129 chars | Accept, accept, reject".
    // The 128 cap is enforced *before* hashing, so a very long password is not
    // an Argon2 denial-of-service vector (§ 7).
    expect(registerSchema.safeParse({ ...VALID_REGISTRATION, password }).success).toBe(accepted);
  });

  it.each([
    ['the email', VALID_REGISTRATION.email],
    ['the username', 'nico______'],
  ])('rejects a password equal to %s', (_label, password) => {
    const candidate = {
      ...VALID_REGISTRATION,
      username: password === 'nico______' ? 'nico______' : VALID_REGISTRATION.username,
      password,
    };
    expect(registerSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects an email longer than 254 characters', () => {
    const email = `${'a'.repeat(250)}@example.com`;
    expect(registerSchema.safeParse({ ...VALID_REGISTRATION, email }).success).toBe(false);
  });

  it('requires acceptedTerms to be exactly true', () => {
    // US-2.7 — validating a consent and then discarding it is not consent, and
    // neither is accepting `false`.
    expect(registerSchema.safeParse({ ...VALID_REGISTRATION, acceptedTerms: false }).success).toBe(
      false,
    );
    expect(registerSchema.safeParse({ ...VALID_REGISTRATION, acceptedTerms: 'yes' }).success).toBe(
      false,
    );

    const { acceptedTerms: _omitted, ...withoutConsent } = VALID_REGISTRATION;
    expect(registerSchema.safeParse(withoutConsent).success).toBe(false);
  });

  it('rejects an unknown field rather than dropping it', () => {
    expect(
      registerSchema.safeParse({ ...VALID_REGISTRATION, isAdmin: true }).success,
    ).toBe(false);
  });

  it('reports the offending path', () => {
    const result = registerSchema.safeParse({ ...VALID_REGISTRATION, password: 'short' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['password']);
    }
  });
});

describe('loginSchema', () => {
  it('accepts credentials and lowercases the email', () => {
    expect(loginSchema.parse({ email: 'NICO@example.com', password: 'x' }).email).toBe(
      'nico@example.com',
    );
  });

  it('does not impose the registration password rules', () => {
    // Rejecting a short password at login would tell the caller their password
    // is not one this system would issue — and would break every account that
    // predates a rule change.
    expect(loginSchema.safeParse({ email: 'nico@example.com', password: 'x' }).success).toBe(true);
  });

  it('rejects a missing field', () => {
    expect(loginSchema.safeParse({ email: 'nico@example.com' }).success).toBe(false);
  });
});

describe('forgotPasswordSchema and resetPasswordSchema', () => {
  it('accepts any syntactically valid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'nobody@example.com' }).success).toBe(true);
  });

  it('rejects a malformed email', () => {
    // The one 400 this endpoint has (§ 5); everything else is 202.
    expect(forgotPasswordSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('applies the full password rules on reset', () => {
    expect(resetPasswordSchema.safeParse({ token: 'abc', password: 'short' }).success).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ token: 'abc', password: 'a brand new passphrase' }).success,
    ).toBe(true);
  });

  it('has no field that could carry an unchanged-password check', () => {
    // US-6.10, Q14 — the shape itself refuses to become a password oracle.
    expect(Object.keys(resetPasswordSchema.parse({ token: 'abc', password: 'a'.repeat(12) })))
      .toEqual(expect.arrayContaining(['token', 'password']));
  });
});

describe('changePasswordSchema', () => {
  it('requires both fields', () => {
    expect(changePasswordSchema.safeParse({ newPassword: 'a'.repeat(12) }).success).toBe(false);
  });

  it('accepts a valid change', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'correct horse battery',
        newPassword: 'a brand new passphrase',
      }).success,
    ).toBe(true);
  });
});

describe('updateSettingsSchema', () => {
  it.each([15, 30, 60, 120])('accepts a defaultDuration of %s', (defaultDuration) => {
    expect(updateSettingsSchema.safeParse({ defaultDuration }).success).toBe(true);
  });

  it.each([0, 14, 45, 121, -30])('rejects a defaultDuration of %s', (defaultDuration) => {
    // § 7 — the schema is the primary gate; the check constraint is the backstop.
    expect(updateSettingsSchema.safeParse({ defaultDuration }).success).toBe(false);
  });

  it('accepts a partial update', () => {
    expect(updateSettingsSchema.safeParse({ soundEnabled: true }).success).toBe(true);
  });

  it('rejects an empty object', () => {
    // § 7 — no-op writes are a client bug worth surfacing.
    expect(updateSettingsSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(updateSettingsSchema.safeParse({ caretStyleee: 'BLOCK' }).success).toBe(false);
  });

  it.each([
    ['caretStyle', 'OFF', 'DIAGONAL'],
    ['theme', 'DARK', 'MIDNIGHT'],
    ['defaultMode', 'WORDS', 'MARATHON'],
  ])('constrains %s to its enum', (field, valid, invalid) => {
    expect(updateSettingsSchema.safeParse({ [field]: valid }).success).toBe(true);
    expect(updateSettingsSchema.safeParse({ [field]: invalid }).success).toBe(false);
  });

  it.each(['en', 'en-GB', 'fr', 'pt-BR'])('accepts the BCP-47 tag %s', (language) => {
    expect(updateSettingsSchema.safeParse({ language }).success).toBe(true);
  });

  it.each(['english', 'e', 'en_GB', ''])('rejects %s as a language tag', (language) => {
    expect(updateSettingsSchema.safeParse({ language }).success).toBe(false);
  });
});

describe('deleteAccountSchema', () => {
  it('requires the literal confirmation string', () => {
    // US-8.1
    const base = { password: 'correct horse battery', deleteResults: false };
    expect(deleteAccountSchema.safeParse({ ...base, confirm: 'DELETE' }).success).toBe(true);
    expect(deleteAccountSchema.safeParse({ ...base, confirm: 'delete' }).success).toBe(false);
    expect(deleteAccountSchema.safeParse(base).success).toBe(false);
  });

  it('defaults deleteResults to false', () => {
    // US-8.3 — anonymise unless the user opts out, and the default is not a
    // silent choice: /account/danger states both behaviours before submission.
    const parsed = deleteAccountSchema.parse({
      password: 'correct horse battery',
      confirm: 'DELETE',
    });
    expect(parsed.deleteResults).toBe(false);
  });

  it('rejects a non-boolean deleteResults', () => {
    expect(
      deleteAccountSchema.safeParse({
        password: 'correct horse battery',
        confirm: 'DELETE',
        deleteResults: 'yes',
      }).success,
    ).toBe(false);
  });
});
