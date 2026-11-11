/**
 * Symmetric AES-256-GCM Credential Crypto Utility
 * Decrypts per-tenant encrypted WABA access tokens stored in `organizations.whatsapp_access_token_encrypted`.
 * Format: `enc:v1:<ivHex>:<authTagHex>:<cipherTextHex>`
 */

import crypto from 'crypto';

const PREFIX = 'enc:v1:';

function getEncryptionKey(): Buffer | null {
  const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!rawKey) return null;

  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }

  const base64Buf = Buffer.from(rawKey, 'base64');
  if (base64Buf.length === 32) {
    return base64Buf;
  }

  return crypto.createHash('sha256').update(rawKey, 'utf8').digest();
}

export function encryptTenantSecret(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error('TOKEN_ENCRYPTION_KEY is required to encrypt tenant credentials');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptTenantSecret(storedValue?: string | null): string | null {
  if (!storedValue) return null;

  if (!storedValue.startsWith(PREFIX)) {
    // Allow legacy/plaintext value only if explicitly stored without prefix
    return storedValue;
  }

  const key = getEncryptionKey();
  if (!key) {
    console.warn('TOKEN_ENCRYPTION_KEY missing; cannot decrypt tenant credential, falling back to master.');
    return null;
  }

  try {
    const parts = storedValue.slice(PREFIX.length).split(':');
    if (parts.length !== 3) return null;

    const [ivHex, tagHex, cipherHex] = parts;
    const ivBuf = Buffer.from(ivHex, 'hex');
    const tagBuf = Buffer.from(tagHex, 'hex');
    const cipherBuf = Buffer.from(cipherHex, 'hex');
    if (ivBuf.length !== 12 || tagBuf.length !== 16 || cipherBuf.length === 0) {
      return null;
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
    decipher.setAuthTag(tagBuf);

    const decrypted = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('Failed to decrypt tenant secret:', err);
    return null;
  }
}
