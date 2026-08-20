import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  totpUri,
  verifyTotp,
} from './totp';

describe('TOTP utilities', () => {
  it('validates the RFC test secret with the six-digit VozLivre format', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(verifyTotp(secret, '287082', 59_000)).toBe(true);
    expect(verifyTotp(secret, '287083', 59_000)).toBe(false);
  });

  it('accepts the adjacent time window and rejects malformed codes', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(verifyTotp(secret, '287082', 89_000)).toBe(true);
    expect(verifyTotp(secret, '12345', 59_000)).toBe(false);
  });

  it('generates valid secrets, URIs and unique recovery codes', () => {
    const secret = generateTotpSecret();
    const codes = generateRecoveryCodes();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(totpUri(secret, 'axel@example.com')).toContain(
      `secret=${secret}&issuer=VozLivre`,
    );
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    expect(codes.every((code) => /^[A-F0-9]{5}-[A-F0-9]{5}$/.test(code))).toBe(
      true,
    );
  });

  it('normalizes recovery codes before hashing', () => {
    expect(normalizeRecoveryCode(' ab12c-de345 ')).toBe('AB12CDE345');
    expect(hashRecoveryCode('AB12C-DE345')).toBe(
      hashRecoveryCode(' ab12c de345 '),
    );
  });
});
