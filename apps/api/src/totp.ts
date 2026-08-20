import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret() {
  return encodeBase32(randomBytes(20));
}

export function totpUri(secret: string, email: string) {
  const label = encodeURIComponent(`VozLivre:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=VozLivre&algorithm=SHA1&digits=6&period=30`;
}

export function verifyTotp(secret: string, input: string, now = Date.now()) {
  const code = input.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(now / 30_000);
  return [-1, 0, 1].some((offset) =>
    safeEqual(code, hotp(secret, counter + offset)),
  );
}

export function generateRecoveryCodes() {
  return Array.from({ length: 8 }, () => {
    const value = randomBytes(5).toString('hex').toUpperCase();
    return `${value.slice(0, 5)}-${value.slice(5)}`;
  });
}

export function hashRecoveryCode(code: string) {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export function normalizeRecoveryCode(code: string) {
  return code
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

function hotp(secret: string, counter: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret))
    .update(buffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value =
    (((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)) %
    1_000_000;
  return value.toString().padStart(6, '0');
}

function encodeBase32(value: Buffer) {
  let bits = 0;
  let current = 0;
  let output = '';
  for (const byte of value) {
    current = (current << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(current >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += BASE32[(current << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string) {
  let bits = 0;
  let current = 0;
  const output: number[] = [];
  for (const char of value.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) continue;
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
