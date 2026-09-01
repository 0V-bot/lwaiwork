/**
 * MIME-type whitelist for the files module.
 *
 * Why a separate file: the rules live at every entry point (DTO, service,
 * POST policy), and we want them to compile to a single Set per process.
 * Duplicating the rule set across files is how an `application/x-msdos-program`
 * slips through "just this once".
 *
 * Policy:
 *   * allow  image/* (any kind; PNG / JPEG / HEIC / AVIF / WebP / SVG / etc.)
 *   * allow  application/pdf
 *   * allow  text/* - but NOT text/html (XSS carrier). Pure text is fine
 *                  for sharing notes / logs; HTML / XHTML stay blocked.
 *   * allow  application/json - for sharing machine-readable snippets
 *   * allow  application/zip  - for archives
 *   * BLOCK  application/octet-stream explicitly. Generic octet-stream was
 *                  historically abused to bypass content-type sniffing; we
 *                  require a real, browsable MIME before we'll issue a
 *                  ticket.
 */
import { UnsupportedMediaTypeException } from '@nestjs/common';

const ALLOWED_TEXT_SUBTYPES = new Set<string>([
  'plain',
  'csv',
  'markdown',
  'xml', // safe in itself; oss will not render
  'javascript',
  'css',
  // intentionally NOT html / xhtml
]);

const ALLOWED_APPLICATION_TYPES = new Set<string>([
  'pdf',
  'json',
  'zip',
  // gzip is treated as application/x-gzip; we allow zip only to keep the
  // surface small. Users with .tar.gz files rename to .zip or use raw oss.
]);

export interface ContentTypeCheck {
  ok: boolean;
  isImage: boolean;
  /**
   * If the input is on the whitelist but in a "risky" bucket (octet-stream,
   * html), we return `ok=false` so the caller can produce the explicit 415
   * error message. `reason` explains which rule fired.
   */
  reason?: string;
}

/**
 * Decide whether `contentType` is acceptable AND whether the resulting object
 * should be classified as `isImage` for UI purposes.
 *
 * The input is matched case-insensitively against the prefix or exact value;
 * we normalise to lowercase first so "Image/PNG" and "image/png" collapse
 * to the same bucket.
 */
export function classifyContentType(raw: string): ContentTypeCheck {
  const ct = (raw ?? '').trim().toLowerCase();
  if (ct.length === 0) {
    return { ok: false, isImage: false, reason: 'contentType is empty' };
  }

  // Explicit block: bare octet-stream is the classic "bypass MIME sniffing"
  // carrier. Real uploads should set a specific type.
  if (ct === 'application/octet-stream') {
    return {
      ok: false,
      isImage: false,
      reason: 'application/octet-stream is not allowed; declare a specific MIME',
    };
  }

  const slash = ct.indexOf('/');
  if (slash <= 0 || slash === ct.length - 1) {
    return { ok: false, isImage: false, reason: 'contentType must be type/subtype' };
  }
  const top = ct.slice(0, slash);
  const sub = ct.slice(slash + 1);

  if (top === 'image') {
    return { ok: true, isImage: true };
  }

  if (top === 'text') {
    if (ALLOWED_TEXT_SUBTYPES.has(sub)) {
      return { ok: true, isImage: false };
    }
    return {
      ok: false,
      isImage: false,
      reason: `text/${sub} is not on the allow-list (html/xhtml are blocked for XSS reasons)`,
    };
  }

  if (top === 'application') {
    if (ALLOWED_APPLICATION_TYPES.has(sub)) {
      return { ok: true, isImage: false };
    }
    return {
      ok: false,
      isImage: false,
      reason: `application/${sub} is not on the allow-list`,
    };
  }

  return {
    ok: false,
    isImage: false,
    reason: `top-level type "${top}" is not allowed (only image, text, application)`,
  };
}

/**
 * Throw a 415 UnsupportedMediaTypeException when the content-type isn't on
 * the allow-list; otherwise return whether the upload is an image. Mirrors
 * the same HTTP semantics at every entry point.
 */
export function ensureAllowedOr415(raw: string): { isImage: boolean } {
  const result = classifyContentType(raw);
  if (!result.ok) {
    throw new UnsupportedMediaTypeException(
      result.reason ?? `contentType "${raw}" is not allowed`,
    );
  }
  return { isImage: result.isImage };
}
