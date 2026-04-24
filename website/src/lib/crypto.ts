// SERVER-ONLY — do not import in client components
import crypto from 'crypto';

/** 64-char hex string (256-bit entropy) */
export function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** SHA-256 of raw key — stored in DB */
export function hashApiKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Constant-time comparison to prevent timing attacks */
export function verifyApiKey(raw: string, hash: string): boolean {
  const rawHash = hashApiKey(raw);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(rawHash, 'hex'),
      Buffer.from(hash,    'hex')
    );
  } catch {
    return false;
  }
}

/** 6-digit numeric code: 100000–999999 */
export function generateLinkingCode(): string {
  return crypto.randomInt(100_000, 1_000_000).toString();
}

/** UUID v4 */
export function generateId(): string {
  return crypto.randomUUID();
}
