/**
 * AES-256-GCM helpers for note title / content encryption.
 *
 * Design choices (each one is the industry default - none of them are negotiable):
 *   * AES-256-GCM - 256-bit key, authenticated cipher (integrity + confidentiality
 *     in one primitive; a flipped ciphertext byte fails the GCM tag check at
 *     decrypt, instead of silently returning garbage).
 *   * 12-byte IV - GCM's recommended length. We pull a fresh random IV for
 *     EVERY encrypt call. Deterministic IVs are a textbook GCM anti-pattern:
 *     they leak which notes share content and catastrophically reduce the
 *     cipher's effective key space under nonce reuse.
 *   * 16-byte auth tag - GCM's natural size; verified on decrypt.
 *
 * SECURITY: the returned `ct / iv / tag` are plain `Buffer`s. They are the
 * raw bytes that get persisted to Postgres bytea columns. Never base64-encode
 * or JSON-stringify them at the boundary - the TypeORM driver speaks Buffer
 * natively.
 *
 * Hard upper bounds:
 *   * TITLE_MAX_BYTES  - 256 bytes of UTF-8 text. The DTO also clamps to 200
 *                        Unicode code points, the byte cap is the last line
 *                        of defence.
 *   * CONTENT_MAX_BYTES - 50 KiB of UTF-8 text. Anything bigger is refused at
 *                         the crypto layer so a malicious client cannot push
 *                         the server into a multi-megabyte blob that lands
 *                         on disk encrypted. (51200 = 50 * 1024.)
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const AES_KEY_BYTES = 32; // 256-bit key
export const AES_IV_BYTES = 12; // GCM-recommended IV length
export const AES_TAG_BYTES = 16; // GCM auth tag length

export const TITLE_MAX_BYTES = 256;
export const CONTENT_MAX_BYTES = 50 * 1024; // 50 KiB

export interface AesCipher {
  /** The encrypted plaintext (same byte length as the input). */
  ct: Buffer;
  /** 12 random bytes - unique per encrypt call. NEVER reuse. */
  iv: Buffer;
  /** 16-byte GCM authentication tag - verified on decrypt. */
  tag: Buffer;
}

/** Thrown when a caller hands us plaintext too big to safely encrypt. */
export class PayloadTooLargeError extends Error {
  constructor(field: 'title' | 'content', byteLength: number, max: number) {
    super(
      `${field} is too large to encrypt: ${byteLength} bytes (max ${max}). ` +
        `Refusing to persist; client must trim the input first.`,
    );
    this.name = 'PayloadTooLargeError';
  }
}

/** Thrown when decrypt fails: bad key, corrupt ct, or GCM tag mismatch. */
export class DecryptionError extends Error {
  constructor(cause?: unknown) {
    super(
      'AES-256-GCM decryption failed - ciphertext, IV or tag do not validate ' +
        'against the configured master key. The row is either corrupt or was ' +
        'encrypted with a different key.',
    );
    this.name = 'DecryptionError';
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

/**
 * Encrypt a UTF-8 string with a 32-byte key. Allocates a fresh 12-byte IV
 * internally and returns it alongside the ciphertext and GCM tag. Each call
 * uses different randomness, so encrypting the same plaintext twice produces
 * different bytes - that is the correct behaviour for GCM.
 *
 * Throws `PayloadTooLargeError` if the input exceeds the field's byte cap.
 */
export function encrypt(plain: string, key: Buffer, field: 'title' | 'content'): AesCipher {
  const max = field === 'title' ? TITLE_MAX_BYTES : CONTENT_MAX_BYTES;
  // byteLength of a Buffer under UTF-8 matches the on-disk size in Postgres bytea.
  const bytes = Buffer.byteLength(plain, 'utf8');
  if (bytes > max) {
    throw new PayloadTooLargeError(field, bytes, max);
  }
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(
      `AES-256-GCM requires a ${AES_KEY_BYTES}-byte key, got ${key.length}. ` +
        `Re-check MASTER_KEY decoding.`,
    );
  }

  const iv = randomBytes(AES_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ct, iv, tag };
}

/**
 * Reverse of `encrypt`. Verifies the GCM auth tag; on mismatch (corrupted
 * bytes, wrong key, or tampering) throws `DecryptionError` rather than
 * returning arbitrary plaintext.
 */
export function decrypt(ct: Buffer, iv: Buffer, tag: Buffer, key: Buffer): string {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(
      `AES-256-GCM requires a ${AES_KEY_BYTES}-byte key, got ${key.length}. ` +
        `Re-check MASTER_KEY decoding.`,
    );
  }
  if (iv.length !== AES_IV_BYTES) {
    throw new DecryptionError();
  }
  if (tag.length !== AES_TAG_BYTES) {
    throw new DecryptionError();
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (err) {
    throw new DecryptionError(err);
  }
}

/**
 * Round-trip self-test used by NotesService.onModuleInit. Throws if the
 * utility is misconfigured, returns silently on success.
 */
export function selfCheck(key: Buffer, logger?: { log: (msg: string) => void }): void {
  const sample = `lwaiwork-notes-selfcheck-${Date.now()}`;
  const enc = encrypt(sample, key, 'content');
  const back = decrypt(enc.ct, enc.iv, enc.tag, key);
  if (back !== sample) {
    throw new Error('AES-256-GCM round-trip failed - encrypt/decrypt mismatch.');
  }
  // Negative case: tampered ciphertext must throw - otherwise we are not
  // actually verifying the GCM tag.
  const tampered = Buffer.from(enc.ct);
  tampered[0] = tampered[0] ^ 0xff;
  let caught = false;
  try {
    decrypt(tampered, enc.iv, enc.tag, key);
  } catch (err) {
    if (err instanceof DecryptionError) caught = true;
  }
  if (!caught) {
    throw new Error(
      'AES-256-GCM round-trip failed - tampered ciphertext was NOT rejected. ' +
        'GCM auth tag is not being verified.',
    );
  }
  if (logger) {
    logger.log('encrypt/decrypt round-trip self-check: OK (auth tag verified)');
  }
}
