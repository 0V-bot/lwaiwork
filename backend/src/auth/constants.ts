/** Redis key prefixes - namespaced so a shared Redis instance stays organised. */
export const REFRESH_KEY_PREFIX = 'lw:rt:';
export const BLACKLIST_KEY_PREFIX = 'lw:bl:';

export const ACCESS_TOKEN_TYPE = 'access';
export const REFRESH_TOKEN_TYPE = 'refresh';

/** Fallbacks only - real values come from JWT_ACCESS_TTL / JWT_REFRESH_TTL. */
export const DEFAULT_ACCESS_TTL = '15m';
export const DEFAULT_REFRESH_TTL = '7d';

/**
 * Parses a duration string ("15m", "7d", "3600s", "1h") into seconds.
 * Returns 0 when the value cannot be parsed so callers can fail loudly.
 */
export function parseTtlToSeconds(ttl: string): number {
  const match = /^\s*(\d+)\s*(s|m|h|d|w)?\s*$/i.exec(ttl);
  if (!match) return 0;

  const value = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();

  const multiplier: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
    w: 7 * 24 * 60 * 60,
  };

  return value * (multiplier[unit] ?? 1);
}

/** Weak-secret blocklist - refuses obviously insecure defaults. */
export const WEAK_SECRETS = new Set([
  'secret',
  'changeme',
  'change_me',
  'your-secret-key',
  'replace_me_with_a_48_byte_random_hex_string',
  'replace_me_with_another_48_byte_random_hex_string',
]);

/** Throws when a JWT secret is missing, too short, or a known placeholder. */
export function assertSecretStrength(secret: string | undefined, label: string): string {
  if (!secret || secret.trim().length === 0) {
    throw new Error(`${label} is not set. Copy .env.example to .env and fill it in.`);
  }
  if (WEAK_SECRETS.has(secret.trim().toLowerCase())) {
    throw new Error(`${label} is a placeholder value. Generate a real one.`);
  }
  if (secret.length < 32) {
    throw new Error(`${label} must be at least 32 characters long.`);
  }
  return secret;
}
