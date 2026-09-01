import { api, ApiError } from './api';
import type {
  ConfirmUploadPayload,
  FileDetail,
  ListFilesQuery,
  Paginated,
  RequestUploadTicketPayload,
  UploadTicketResponse,
} from '@/types';

/**
 * Files SDK.
 *
 * The shape mirrors the other module-level SDKs (api + auth live alongside
 * each other in src/lib): a thin, typed wrapper over `api.{get,post,del}`
 * that returns parsed DTOs and surfaces server-side errors as ApiError.
 *
 * One helper is module-local and not part of `lib/api.ts`:
 *   * `uploadFileToOss(ticket, blob)` PUTs the multipart body directly to OSS
 *     and returns the ETag header. The backend hands us a short-lived POST
 *     policy in the ticket; we have to honour the form-field ordering rule
 *     (text fields before the file part) or OSS returns 400.
 *
 * Why a separate file from `api.ts`: the file upload is the only consumer
 * that talks to a host other than the NestJS backend, and conflating the
 * two would require teaching `api.ts` about OSS-style PUTs with no auth
 * header, custom form bodies, and a 302-ish success criterion (OSS returns
 * 200 + an `ETag` header on success, not a JSON body).
 */

interface OssPutResult {
  etag: string;
}

/**
 * PUT the bytes to OSS using the multipart form fields returned by the
 * upload ticket. OSS's PostObject contract requires:
 *   * Text fields first (key, policy, OSSAccessKeyId, signature, …)
 *   * The `file` part LAST
 *   * `x-oss-success-action-status: 200` so a 2xx response (not a 3xx
 *     redirect) is what we treat as success.
 *
 * On success OSS replies with 200 + an `ETag` header. A non-2xx reply
 * becomes an ApiError with the upstream body as `details`.
 *
 * The fetch is `credentials: 'omit'` because the bucket is CORS-configured
 * to allow `*` for the file PUT — we never want the user's cookies carried
 * to a third-party domain.
 */
export async function uploadFileToOss(
  ticket: UploadTicketResponse,
  blob: Blob,
): Promise<OssPutResult> {
  const form = new FormData();

  // The form fields we MUST set first (mirrors OSS PostObject spec).
  form.set('key', ticket.form.key);
  form.set('policy', ticket.form.policy);
  form.set('OSSAccessKeyId', ticket.form.OSSAccessKeyId);
  form.set('Signature', ticket.form.signature);
  form.set('x-oss-success-action-status', ticket.form['x-oss-success-action-status']);
  if (ticket.form['Content-Type']) {
    form.set('Content-Type', ticket.form['Content-Type']);
  }

  // The file part last. Browser will read `blob` and emit a multipart section
  // with its own Content-Type (e.g. image/png) - OSS checks it against the
  // POST policy condition.
  form.append('file', blob);

  let response: Response;
  try {
    response = await fetch(ticket.uploadUrl, {
      method: 'POST',
      body: form,
      credentials: 'omit',
    });
  } catch (error) {
    throw new ApiError(
      '上传到 OSS 失败，请检查网络后重试。',
      0,
      error,
    );
  }

  if (!response.ok) {
    // Read the body once - OSS returns a short XML or HTML error document
    // we can surface verbatim for debugging.
    const text = await response.text();
    throw new ApiError(
      `OSS 上传失败（HTTP ${response.status}）`,
      response.status,
      text,
    );
  }

  const etag = response.headers.get('ETag') ?? response.headers.get('etag');
  if (!etag) {
    throw new ApiError(
      'OSS 上传成功但未返回 ETag，请重试。',
      response.status,
      null,
    );
  }

  return { etag };
}

/**
 * Step 1 of the upload flow. Returns the OSS POST-policy + reserved
 * ossKey + reserved fileId. No auth header tweak needed; `api.post`
 * defaults to `auth: true` and attaches the Bearer token for us.
 */
export function requestUploadTicket(
  payload: RequestUploadTicketPayload,
): Promise<UploadTicketResponse> {
  return api.post<UploadTicketResponse>('/files/upload-ticket', payload);
}

/**
 * Step 3 of the upload flow. `payload.ossKey` and `payload.etag` come
 * straight from the prior two steps.
 */
export function confirmUpload(payload: ConfirmUploadPayload): Promise<FileDetail> {
  return api.post<FileDetail>('/files/confirm', payload);
}

/** GET /files — paginated summary list. */
export function listFiles(
  query: ListFilesQuery = {},
): Promise<Paginated<FileDetail>> {
  // The backend returns FileDetail (with downloadUrl) on the list endpoint
  // for thumbnail rendering; the type alias is `FileSummary` upstream, but
  // here the service actually emits the full row to keep the gallery cheap.
  // We re-use the FileDetail shape because that's what the gallery renders.
  // (See backend/files.service.ts#findAll.)
  const normalised = {
    page: query.page ?? 1,
    limit: query.limit ?? 20,
    includeArchived: query.includeArchived ?? false,
    imagesOnly: query.imagesOnly ?? false,
  } as const;
  return api.get<Paginated<FileDetail>>('/files', { query: normalised });
}

/** GET /files/:id — full detail with a short-lived download URL. */
export function getFile(id: string): Promise<FileDetail> {
  return api.get<FileDetail>(`/files/${id}`);
}

/** DELETE /files/:id — soft-archive (idempotent on the backend). */
export function archiveFile(
  id: string,
): Promise<{ message: string }> {
  return api.del<{ message: string }>(`/files/${id}`);
}
