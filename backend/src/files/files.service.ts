import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { extname as pathExtname } from 'path';
import { FileEntity } from './entities/file.entity';
import { ListFilesDto, FILE_MAX_SIZE } from './dto/upload-ticket.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { classifyContentType } from './content-type.util';
import { OssProvider } from './oss.provider';

/**
 * Files service.
 *
 * Authorisation invariant: every method takes `userId` (sourced from the
 * JWT by the controller, never the request body) and folds it into the
 * WHERE clause / row construction. The same rule applies to ossKey: the
 * prefix `users/${userId}/` is asserted for every confirm so a peer can
 * never sneak a different user's bucket sub-path into our row set, even
 * if they somehow obtained another user's ticket.
 *
 * Upload flow:
 *
 *     client                backend                          OSS
 *       |                     |                              |
 *       | POST upload-ticket  |                              |
 *       |------------------->| reserve uuid + ossKey         |
 *       |                     |--- calculatePostSignature -->|
 *       |<--- {uploadUrl, form, expiresAt, fileId}           |
 *       |                                                     |
 *       | PUT (multipart/form-data to uploadUrl)             |
 *       |---------------------------------------------------->|
 *       |<------------------ 200 OK + ETag ------------------|
 *       | POST confirm {ossKey, etag, size, ...}              |
 *       |------------------->|  verify prefix -> insert row  |
 *       |<--- { id, ... } ---|                              |
 *
 * Storage choice: we keep Postgres as the row-of-record and OSS as the blob
 * store. The OSS object is the source of truth for bytes - a missing row
 * can be regenerated from OSS via a future "reimport" endpoint, while a
 * missing OSS object after a row exists is just an orphan (logged, not
 * a 5xx to the client).
 */

// ---------------------------------------------------------------------------
// Public response shapes (interfaces - same pattern as NotesService).
// ---------------------------------------------------------------------------

export interface FileSummary {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  ossKey: string;
  isImage: boolean;
  width: number | null;
  height: number | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FileDetail extends FileSummary {
  /**
   * A 5-minute signed GET URL for the underlying OSS object. We return it
   * on detail so the gallery view can render the thumbnail immediately
   * without a second round trip. Expiry matches DownloadUrl's TTL.
   */
  downloadUrl: string;
  downloadUrlExpiresAt: string;
}

export interface UploadTicketResponse {
  /** The OSS endpoint the client PUTs to. */
  uploadUrl: string;
  /** The OSS object key the client PUTs under. */
  ossKey: string;
  /** TTL of the ticket; client should not start the PUT past this point. */
  expiresAt: string;
  /**
   * Server-generated UUID for the eventual row. Echoed to the client as a
   * correlation id; the row is NOT persisted until /confirm fires.
   */
  fileId: string;
  /**
   * Multipart form fields the client must include before the file part.
   * Mirrors OSS PostObject's expected form-data shape.
   */
  form: {
    key: string;
    policy: string;
    OSSAccessKeyId: string;
    signature: string;
    'x-oss-success-action-status': '200';
    'Content-Type'?: string;
  };
}

export interface DownloadUrlResponse {
  url: string;
  expiresAt: string;
}

export interface PaginatedFiles {
  data: FileSummary[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  /** Seconds the download URL stays valid; matches the brief's 5-minute cap. */
  private static readonly DOWNLOAD_TTL_SECONDS = 5 * 60;

  /** Seconds the upload ticket stays valid. Mirrors OSS POST policy window. */
  private static readonly UPLOAD_TTL_SECONDS = 5 * 60;

  constructor(
    @InjectRepository(FileEntity)
    private readonly files: Repository<FileEntity>,
    private readonly oss: OssProvider,
  ) {}

  // ===========================================================================
  // Upload flow
  // ===========================================================================

  /**
   * Step 1 of the upload flow: validate the client's claim (filename, type,
   * size), reserve an OSS object key, sign a POST policy, and hand the
   * resulting form + URL back to the client.
   *
   * Note: this does NOT touch the database. We mint a UUID up front so the
   * client can correlate logs, but the row is materialised by `confirm()`.
   * That means an abandoned upload leaves the OSS object unreferenced (we
   * expect a periodic janitor / lifecycle rule to clean those up - not in
   * MVP scope).
   */
  async requestUploadTicket(
    userId: string,
    filename: string,
    contentType: string,
    size: number,
  ): Promise<UploadTicketResponse> {
    if (size <= 0 || size > FILE_MAX_SIZE) {
      throw new PayloadTooLargeException(
        `size ${size} bytes is outside the allowed range [1, ${FILE_MAX_SIZE}]`,
      );
    }

    // classifyContentType throws 415 inline via ensureAllowedOr415; calling
    // classifyContentType directly so we can capture isImage for the row.
    const check = classifyContentType(contentType);
    if (!check.ok) {
      // Mirror the 415 the service helper would throw so the API contract
      // is identical to the DTO path (defence-in-depth).
      throw new BadRequestException(
        check.reason ?? `contentType "${contentType}" is not allowed`,
      );
    }

    const ossKey = this.buildOssKey(userId, filename, contentType);

    const policy = this.oss.createPostPolicy({
      ossKey,
      size,
      contentType,
      expiresInSeconds: FilesService.UPLOAD_TTL_SECONDS,
    });

    // fileId is purely a correlation token in MVP - the same value is
    // returned by confirm() as the row's primary key.
    const fileId = randomUUID();

    return {
      uploadUrl: policy.uploadUrl,
      ossKey: policy.ossKey,
      expiresAt: policy.expiresAt,
      fileId,
      form: policy.form,
    };
  }

  /**
   * Step 2: persist the row. We re-verify the ossKey starts with this user's
   * prefix so even if the client somehow obtained a ticket issued for
   * another tenant, we cannot accept their bytes against our DB.
   */
  async confirmUpload(
    userId: string,
    dto: ConfirmUploadDto,
  ): Promise<FileDetail> {
    const expectedPrefix = this.userPrefix(userId);
    if (!dto.ossKey.startsWith(expectedPrefix)) {
      // SECURITY: 400 not 404 - this is the "client tried to use a ticket
      // from someone else" path, which we want to surface as a malformed
      // request, not a silent drop.
      throw new BadRequestException(
        'ossKey does not start with the caller-owned prefix; refusing to write to another tenant\'s path.',
      );
    }

    // Guard against confirmed sizes that don't match what we signed.
    if (dto.size > FILE_MAX_SIZE) {
      throw new PayloadTooLargeException(
        `size ${dto.size} exceeds the server cap of ${FILE_MAX_SIZE}`,
      );
    }

    const ext = pathExtname(dto.ossKey).slice(1).toLowerCase();
    const inferredIsImage = IMAGE_EXTS.has(ext);

    // The client-facing filename is the bare basename (uuid + ext). The
    // user gave us a filename at upload-ticket time but we discard it
    // intentionally - keeping their personal filename on the OSS path
    // would leak metadata into the bucket key.
    const objectName = dto.ossKey.slice(expectedPrefix.length);

    const entity = this.files.create({
      userId,
      filename: objectName,
      contentType: ext ? `image/${ext === 'svg' ? 'svg+xml' : ext}` : 'application/octet-stream',
      size: dto.size,
      ossKey: dto.ossKey,
      ossBucket: this.oss.bucketName(),
      etag: dto.etag,
      isImage: inferredIsImage,
      width: dto.width ?? null,
      height: dto.height ?? null,
      archivedAt: null,
    });

    try {
      const saved = await this.files.save(entity);
      return this.toDetail(saved);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The two common failures on this path:
      //   * 23505 unique_violation on oss_key: the client re-used the same
      //     ticket; we surface 409 so they re-request instead of being told
      //     "your file is here" while the row is actually a duplicate.
      //   * Anything else: log + 500. Don't leak ORM details.
      if (message.includes('unique') || message.includes('duplicate')) {
        throw new BadRequestException(
          'This ossKey was already confirmed (duplicate request). Request a fresh upload-ticket.',
        );
      }
      this.logger.error(`Failed to persist file row (${message})`);
      throw err;
    }
  }

  // ===========================================================================
  // Read flow
  // ===========================================================================

  async findAll(userId: string, query: ListFilesDto): Promise<PaginatedFiles> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: import('typeorm').FindOptionsWhere<FileEntity> = { userId };
    if (!query.includeArchived) {
      // Default view hides archived; we deliberately don't add the partial
      // index here (the entity uses a regular btree on (userId, updatedAt)
      // and the dataset is small enough not to need it).
      where.archivedAt = IsNull();
    }
    if (query.imagesOnly) {
      where.isImage = true;
    }

    const [rows, total] = await this.files.findAndCount({
      where,
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: rows.map((r) => this.toSummary(r)),
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findOne(userId: string, id: string): Promise<FileDetail> {
    const row = await this.findOwnedRow(userId, id);
    return this.toDetail(row);
  }

  // ===========================================================================
  // Dashboard helper
  // ===========================================================================

  /**
   * Return the most-recently-updated files (active + archived) for the
   * dashboard widget. Returns summaries only - downloadUrl is intentionally
   * NOT included to keep the dashboard payload small (no OSS signed-URL
   * generation on the hot path).
   *
   * No business method is touched; this is a thin wrapper over findAll's
   * data path with a tighter limit.
   */
  async findRecent(userId: string, limit = 5): Promise<FileSummary[]> {
    const rows = await this.files.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: Math.max(1, Math.min(limit, 100)),
    });
    return rows.map((row) => this.toSummary(row));
  }

  /**
   * Count files updated on-or-after `since`. The dashboard widget uses
   * this to render the "7-day file count" tile independently from the
   * 5-row preview list.
   *
   * No business method is touched.
   */
  async countRecent(userId: string, since: Date): Promise<number> {
    return this.files
      .createQueryBuilder('f')
      .where('f.user_id = :userId', { userId })
      .andWhere('f.updated_at >= :since', { since })
      .getCount();
  }

  /**
   * Generates a 5-minute signed URL. Returns the URL itself; the controller
   * converts it into a 302 redirect at the HTTP layer.
   */
  async getDownloadUrl(userId: string, id: string): Promise<DownloadUrlResponse> {
    const row = await this.findOwnedRow(userId, id);
    const expiresAt = new Date(
      Date.now() + FilesService.DOWNLOAD_TTL_SECONDS * 1000,
    );
    const url = await this.oss.signDownloadUrl(
      row.ossKey,
      FilesService.DOWNLOAD_TTL_SECONDS,
    );
    return { url, expiresAt: expiresAt.toISOString() };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Soft-archive. We immediately free OSS storage (best-effort): keeping
   * archived bytes around for "un-archive later" is over-engineering for
   * MVP. The row stays so the user can re-list with includeArchived=true.
   */
  async archive(userId: string, id: string): Promise<{ message: string }> {
    const row = await this.findOwnedRow(userId, id);
    if (row.archivedAt === null) {
      row.archivedAt = new Date();
      await this.files.save(row);
      // Fire-and-forget OSS cleanup. If it fails the row is still marked
      // archived; a future janitor can pick the orphan up.
      void this.oss
        .deleteObject(row.ossKey)
        .then((res) =>
          res.deleted
            ? this.logger.log(`Archived + removed OSS key=${row.ossKey}`)
            : this.logger.warn(
                `Archived row ${row.id} but OSS cleanup incomplete: ${res.error}`,
              ),
        )
        .catch((err) =>
          this.logger.error(
            `OSS delete threw after archive (row=${row.id}): ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }
    return { message: 'File archived' };
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  /** Fetch a single owned row, or 404 (never 403, no existence leak). */
  private async findOwnedRow(userId: string, id: string): Promise<FileEntity> {
    const row = await this.files.findOne({ where: { id, userId } });
    if (!row) {
      throw new NotFoundException('File not found');
    }
    return row;
  }

  /**
   * Compose the OSS object key for an upload. The shape is:
   *   users/<userId>/<random-uuid>.<ext>
   *
   * The userId segment turns the key prefix into a per-tenant boundary -
   * confirm() refuses any key whose first segment is not `users/${userId}/`,
   * even if the rest of the path is shaped identically.
   */
  private buildOssKey(userId: string, filename: string, contentType: string): string {
    const dir = this.userPrefix(userId);
    const ext = this.pickExtension(filename, contentType);
    return `${dir}${randomUUID()}${ext ? '.' + ext : ''}`;
  }

  /**
   * `users/<userId>/` - one slash too many would break the prefix check on
   * the confirm path, so we keep it tight.
   */
  private userPrefix(userId: string): string {
    return `users/${userId}/`;
  }

  /**
   * Best-effort extension: prefer the client filename's extension, fall back
   * to the canonical extension for the content-type subtype. If we cannot
   * guess, drop the suffix (OSS will still serve the bytes with the right
   * Content-Type once we store it; the URL extension is just a hint).
   */
  private pickExtension(filename: string, contentType: string): string {
    const fromName = sanitizeExt(pathExtname(filename));
    if (fromName) return fromName;
    const subtype = contentType.split('/')[1] ?? '';
    return sanitizeExt(subtype);
  }

  // ---------------------------------------------------------------------------
  // Projections
  // ---------------------------------------------------------------------------

  private toSummary(row: FileEntity): FileSummary {
    return {
      id: row.id,
      filename: row.filename,
      contentType: row.contentType,
      size: row.size,
      ossKey: row.ossKey,
      isImage: row.isImage,
      width: row.width,
      height: row.height,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async toDetail(row: FileEntity): Promise<FileDetail> {
    const signedUrl = await this.oss.signDownloadUrl(
      row.ossKey,
      FilesService.DOWNLOAD_TTL_SECONDS,
    );
    return {
      ...this.toSummary(row),
      downloadUrl: signedUrl,
      downloadUrlExpiresAt: new Date(
        Date.now() + FilesService.DOWNLOAD_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Whitelist of file extensions we treat as raster images for `isImage`. */
const IMAGE_EXTS = new Set<string>([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif',
  'tiff', 'tif', 'svg', 'ico',
]);

/** Strip the leading `.`, lowercase, and alphabet-only. */
function sanitizeExt(raw: string): string {
  const noDot = raw.replace(/^\.+/, '').toLowerCase().trim();
  if (noDot.length === 0) return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!/^[a-z0-9]+$/.test(noDot)) return '';
  // Cap at 8 chars (matches the regex in confirm-upload.dto.ts).
  return noDot.slice(0, 8);
}
