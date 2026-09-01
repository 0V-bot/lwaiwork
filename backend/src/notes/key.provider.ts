/**
 * Master-key provider for the notes module.
 *
 * The key lives only in process memory. It is loaded from the `MASTER_KEY`
 * env var (configured in `.env` / `.env.production`); the value is never
 * logged, never sent to clients, and never persists to disk.
 *
 * Accepted encodings (length-tested, no guessing):
 *   * hex      : 64 ASCII chars -> 32 bytes -> AES_KEY_BYTES
 *   * base64   : 44 ASCII chars (with or without padding) -> 32 bytes
 *
 * We accept both so deployments can paste either form. Length is enough
 * proof - a true 32-byte hex string is always 64 chars, base64 always 44.
 * No ambiguous `try hex else base64` branch.
 *
 * SECURITY: if the env var is missing, blank, or wrong-length, we log a loud
 * warning at construction time but DO NOT throw. Why? So the rest of the app
 * (auth, users, etc.) can still start in dev. Writes go through
 * `assertWritable()` below, which throws at the moment we would actually put
 * ciphertext on disk - so a missing key cannot quietly produce plaintext rows.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AES_KEY_BYTES } from './crypto-aes-gcm';

const HEX_BODY_LEN = AES_KEY_BYTES * 2; // 64
const BASE64_BODY_LEN = 44; // ceil(32 * 4/3) = 44 with padding

export enum KeyEncoding {
  Hex = 'hex',
  Base64 = 'base64',
}

@Injectable()
export class NotesKeyProvider {
  private readonly logger = new Logger(NotesKeyProvider.name);

  /** Parsed 32-byte key, or null when MASTER_KEY is not configured. */
  private readonly key: Buffer | null;
  /** How the configured value was encoded, for diagnostics only. */
  private readonly encoding: KeyEncoding | null;
  /** Length of the raw env var string, for the warning message. */
  private readonly rawLength: number;

  constructor(config: ConfigService) {
    const raw = config.get<string>('MASTER_KEY');
    this.rawLength = raw?.length ?? 0;

    if (!raw || raw.trim().length === 0) {
      this.key = null;
      this.encoding = null;
      this.logger.error(
        '\x1b[31m' +
          'MASTER_KEY is not set. The notes module will REFUSE write operations. ' +
          'Generate one with: openssl rand -hex 32   (or: openssl rand -base64 32) ' +
          'and put it in your env file. NEVER commit the value.' +
          '\x1b[0m',
      );
      return;
    }

    const parsed = parseKey(raw);
    if (parsed instanceof Error) {
      this.key = null;
      this.encoding = null;
      this.logger.error(
        `MASTER_KEY is present but invalid (${parsed.message}). ` +
          `Length: ${raw.length}. Expected ${HEX_BODY_LEN} hex chars or ` +
          `${BASE64_BODY_LEN} base64 chars. Notes writes are disabled.`,
      );
      return;
    }

    this.key = parsed;
    this.encoding = raw.trim().length === HEX_BODY_LEN ? KeyEncoding.Hex : KeyEncoding.Base64;
    this.logger.log(
      `MASTER_KEY loaded (encoding=${this.encoding}, length=${raw.length}). ` +
        `Value is never logged.`,
    );
  }

  /** Lazily throws so we can stamp the SAME message in the request path. */
  getKey(): Buffer {
    if (this.key === null) {
      throw new ServiceUnavailableException(
        'Notes encryption key (MASTER_KEY) is not configured. Set MASTER_KEY ' +
          'in the server environment and restart.',
      );
    }
    return this.key;
  }

  /**
   * Call this at the top of every note mutation. Same throw contract as
   * `getKey()`, but named after the security invariant so reviewers see the
   * intent at every call site.
   */
  assertWritable(): Buffer {
    return this.getKey();
  }

  /** True iff a valid key was loaded at construction time. */
  isConfigured(): boolean {
    return this.key !== null;
  }
}

/**
 * Decode a 64-char hex string OR a 44-char base64 string to 32 bytes.
 * Returns an Error describing the problem instead of throwing so the
 * constructor can log with proper context.
 */
function parseKey(raw: string): Buffer | Error {
  const trimmed = raw.trim();

  if (trimmed.length === HEX_BODY_LEN && /^[0-9a-fA-F]+$/.test(trimmed)) {
    try {
      const buf = Buffer.from(trimmed, 'hex');
      if (buf.length === AES_KEY_BYTES) return buf;
    } catch {
      // fall through to error
    }
  }

  if (
    (trimmed.length === BASE64_BODY_LEN || trimmed.length === BASE64_BODY_LEN + 1) &&
    /^[A-Za-z0-9+/=]+$/.test(trimmed)
  ) {
    try {
      const buf = Buffer.from(trimmed, 'base64');
      if (buf.length === AES_KEY_BYTES) return buf;
    } catch {
      // fall through to error
    }
  }

  return new Error(
    `expected ${HEX_BODY_LEN} hex chars or ~${BASE64_BODY_LEN} base64 chars producing ` +
      `${AES_KEY_BYTES} bytes`,
  );
}
