/**
 * Generate the plaintext "preview" snippet that backs the list / search UX.
 *
 * Spec:
 *   * The first 200 code points of the note body, AFTER collapsing internal
 *     whitespace so the snippet reads naturally.
 *   * Stored as plaintext `preview varchar(200)` so list views and full-text-
 *     search can hit it without ever calling decrypt(). The full content
 *     stays encrypted at rest - we deliberately never persist anything beyond
 *     this small snippet.
 *
 * Implementation notes:
 *   * We split on the Unicode code-point array (`Array.from`) instead of
 *     `string.slice(0, 200)` because JavaScript strings are UTF-16 and a raw
 *     slice can cut a surrogate pair in half. Code-point iteration is the
 *     safe middle ground - we don't ship a Unicode-aware glyph library.
 *   * Whitespace normalisation runs BEFORE truncation so the produced snippet
 *     is what a human would actually see when previewing.
 */

export const PREVIEW_MAX_CODE_POINTS = 200;

/**
 * Produce a single-line-ish preview of `content`. Newlines and runs of spaces
 * are flattened to a single space, then the result is trimmed and cut to
 * PREVIEW_MAX_CODE_POINTS code points.
 */
export function buildPreview(content: string): string {
  if (!content) return '';

  // Collapse: any whitespace run (including newlines, tabs) -> single space.
  // Leading and trailing whitespace on the whole string is dropped later.
  const collapsed = content.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return '';

  // Code-point slice: avoid splitting a surrogate pair (e.g. emoji).
  const codePoints = Array.from(collapsed);
  if (codePoints.length <= PREVIEW_MAX_CODE_POINTS) return collapsed;
  return codePoints.slice(0, PREVIEW_MAX_CODE_POINTS).join('');
}
