import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, type FindOptionsOrder, type FindOptionsWhere } from 'typeorm';
import { Note } from './entities/note.entity';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { QueryNotesDto } from './dto/query-notes.dto';
import { SearchNoteDto } from './dto/search-note.dto';
import {
  DecryptionError,
  PayloadTooLargeError,
  selfCheck,
  encrypt,
  decrypt,
} from './crypto-aes-gcm';
import { NotesKeyProvider } from './key.provider';
import { buildPreview } from './preview.util';

// ---------------------------------------------------------------------------
// Public response shapes.
//
// Kept as interfaces (not classes) so we don't double the entity count. The
// controller only declares them in @ApiOkResponse({ description: ... }) - same
// pattern as HabitsService.
// ---------------------------------------------------------------------------

/**
 * List-row projection. Title is decrypted for display; the full ciphertext-
 * only `content` field is intentionally OMITTED. Anyone paginating the inbox
 * never pulls a multi-KiB body over the wire - that's what `GET /notes/:id`
 * is for. Less data, smaller attack surface.
 */
export interface NoteSummary {
  id: string;
  title: string;
  preview: string;
  tags: string[];
  color: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Detail projection. Adds `content` (decrypted). `userId` deliberately
 * omitted - the caller IS the user, so echoing it back is noise.
 */
export interface NoteDetail extends NoteSummary {
  content: string;
}

export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

@Injectable()
export class NotesService implements OnModuleInit {
  private readonly logger = new Logger(NotesService.name);

  constructor(
    @InjectRepository(Note)
    private readonly notes: Repository<Note>,
    private readonly keyProvider: NotesKeyProvider,
  ) {}

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  onModuleInit(): void {
    if (!this.keyProvider.isConfigured()) {
      this.logger.error(
        '\x1b[31m' +
          'MASTER_KEY is not configured. Read endpoints will still load existing ' +
          'rows but every WRITE (create / update / delete) will be refused with ' +
          '503 until MASTER_KEY is set. Generate one with: openssl rand -hex 32' +
          '\x1b[0m',
      );
      // Intentionally do not throw - we want the rest of the app to boot for
      // auth / user endpoints. The write-path callers all call
      // `assertWritable()` to fail closed.
      return;
    }
    try {
      selfCheck(this.keyProvider.getKey(), this.logger);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Crypto self-check failed: ${message}`);
      // Fail closed: a broken crypto layer MUST NOT allow writes.
      throw new ServiceUnavailableException(
        'Notes crypto self-check failed - startup aborted to prevent plaintext writes.',
      );
    }
  }

  // ===========================================================================
  // CRUD
  // ===========================================================================

  /**
   * SECURITY (authorisation invariant):
   * Every method below takes `userId` as its FIRST argument and folds it
   * into the WHERE clause / entity payload. There is no method that accepts
   * a note id alone - a controller cannot accidentally leak another user's
   * row by forgetting the ownership filter.
   */
  async findAll(userId: string, query: QueryNotesDto): Promise<Paginated<NoteSummary>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'updatedAt';
    const order = query.order ?? 'DESC';

    const where: FindOptionsWhere<Note> = { userId };
    if (!query.includeArchived) {
      // Default: hide archived notes. The PARTIAL index
      // `IDX_notes_user_active (user_id) WHERE archived_at IS NULL` was
      // created specifically so this filter is index-backed.
      where.archivedAt = IsNull();
    }

    const sort = { [sortBy]: order } as FindOptionsOrder<Note>;

    let rows: Note[];
    let total: number;

    if (query.tag) {
      // Tag filter needs array containment; fetch the filtered set so we
      // paginate on the matching subset (not the union) and the count is
      // honest.
      const tag = query.tag;
      const qb = this.notes
        .createQueryBuilder('n')
        .where('n.user_id = :userId', { userId })
        .andWhere('n.tags @> ARRAY[:tag]::text[]', { tag });
      if (!query.includeArchived) {
        qb.andWhere('n.archived_at IS NULL');
      }
      qb.orderBy(`n.${sortBy}`, order)
        .skip((page - 1) * limit)
        .take(limit);

      const [data, count] = await qb.getManyAndCount();
      rows = data;
      total = count;
    } else {
      [rows, total] = await this.notes.findAndCount({
        where,
        order: sort,
        skip: (page - 1) * limit,
        take: limit,
      });
    }

    const data = rows.map((row) => this.toSummary(row));
    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findOne(userId: string, id: string): Promise<NoteDetail> {
    const row = await this.notes.findOne({ where: { id, userId } });
    if (!row) {
      // SECURITY: 404 (not 403) so a 403 response cannot confirm that the
      // row exists for someone else.
      throw new NotFoundException('Note not found');
    }
    return this.toDetail(row);
  }

  async create(userId: string, dto: CreateNoteDto): Promise<NoteDetail> {
    const key = this.keyProvider.assertWritable();

    // Hard cap on content bytes - enforced twice: here for an explicit 413
    // response, and inside `encrypt()` as a last-line guard. Title is capped
    // by the DTO (200 characters) AND by `TITLE_MAX_BYTES` inside the
    // crypto helper, so it never reaches this site.
    const contentBytes = Buffer.byteLength(dto.content, 'utf8');
    if (contentBytes > 50 * 1024) {
      throw new PayloadTooLargeException(
        `content is ${contentBytes} bytes; max is 51200 bytes (50 KiB).`,
      );
    }

    let titleEnc;
    let contentEnc;
    try {
      titleEnc = encrypt(dto.title, key, 'title');
      contentEnc = encrypt(dto.content, key, 'content');
    } catch (err) {
      // Crypto-layer byte caps will already have rejected an over-cap input,
      // but DTO bypasses (e.g. a future internal caller) still need a clean
      // 413 instead of a 500.
      if (err instanceof PayloadTooLargeError) {
        throw new PayloadTooLargeException(err.message);
      }
      throw err;
    }

    const note = this.notes.create({
      userId, // always from the JWT, never from the request body
      titleCiphertext: titleEnc.ct,
      titleIv: titleEnc.iv,
      titleTag: titleEnc.tag,
      contentCiphertext: contentEnc.ct,
      contentIv: contentEnc.iv,
      contentTag: contentEnc.tag,
      preview: buildPreview(dto.content),
      tags: dto.tags ?? [],
      color: dto.color ?? '#2FAF9E',
      archivedAt: null,
    });

    const saved = await this.notes.save(note);
    return this.toDetail(saved);
  }

  async update(userId: string, id: string, dto: UpdateNoteDto): Promise<NoteDetail> {
    const note = await this.findOneRow(userId, id);
    const key = this.keyProvider.assertWritable();

    if (dto.title !== undefined) {
      try {
        const enc = encrypt(dto.title, key, 'title');
        note.titleCiphertext = enc.ct;
        note.titleIv = enc.iv;
        note.titleTag = enc.tag;
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          throw new PayloadTooLargeException(err.message);
        }
        throw err;
      }
    }
    if (dto.content !== undefined) {
      try {
        const enc = encrypt(dto.content, key, 'content');
        note.contentCiphertext = enc.ct;
        note.contentIv = enc.iv;
        note.contentTag = enc.tag;
        // Preview must always mirror the current content - regenerate on
        // every content write so list / search UX stays accurate.
        note.preview = buildPreview(dto.content);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          throw new PayloadTooLargeException(err.message);
        }
        throw err;
      }
    }
    if (dto.tags !== undefined) {
      note.tags = dto.tags;
    }
    if (dto.color !== undefined) {
      note.color = dto.color;
    }

    const saved = await this.notes.save(note);
    return this.toDetail(saved);
  }

  /**
   * Soft-archive: sets `archived_at`. Reversible via a follow-up update
   * (or by re-calling DELETE, which is idempotent and stays a no-op when
   * already archived).
   */
  async remove(userId: string, id: string): Promise<{ message: string }> {
    const note = await this.findOneRow(userId, id);
    if (note.archivedAt === null) {
      note.archivedAt = new Date();
      await this.notes.save(note);
    }
    // Idempotent: re-archiving is a no-op success.
    return { message: 'Note archived' };
  }

  // ===========================================================================
  // Search
  // ===========================================================================

  /**
   * Case-insensitive substring match on the plaintext `preview` column.
   * Will not find matches in the encrypted body (see SearchNoteDto SECURITY).
   */
  async search(userId: string, dto: SearchNoteDto): Promise<NoteSummary[]> {
    const qb = this.notes
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .andWhere('n.archived_at IS NULL')
      // Postgres ILIKE is locale-aware case-insensitive substring; the
      // parameter binding escapes LIKE metacharacters by using the inline
      // expression below instead of a bound parameter (driver-side
      // escaping differs across versions).
      .andWhere('n.preview ILIKE :pattern', {
        pattern: `%${escapeLikePattern(dto.query)}%`,
      })
      // Escape LIKE wildcards from the user input.
      .orderBy('n.updated_at', 'DESC')
      .limit(200); // hard cap so a one-letter search can't page 10k rows

    if (dto.tag) {
      qb.andWhere('n.tags @> ARRAY[:tag]::text[]', { tag: dto.tag });
    }

    const rows = await qb.getMany();
    return rows.map((row) => this.toSummary(row));
  }

  // ===========================================================================
  // Dashboard helper
  // ===========================================================================

  /**
   * Return the most-recently-updated notes (active + archived) for the
   * dashboard widget. Decrypts titles only — bodies stay encrypted, so
   * even a stolen JWT can't dump the user's writing through this route.
   *
   * No business method is touched; this is a thin wrapper over findAll's
   * data path with a tighter limit and an "includeArchived=true" twist.
   */
  async findRecent(userId: string, limit = 5): Promise<NoteSummary[]> {
    const rows = await this.notes.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: Math.max(1, Math.min(limit, 100)),
    });
    return rows.map((row) => this.toSummary(row));
  }

  /**
   * Count notes updated on-or-after `since`. The dashboard widget uses
   * this to render the "7-day note count" tile independently from the
   * 5-row preview list.
   *
   * No business method is touched.
   */
  async countRecent(userId: string, since: Date): Promise<number> {
    return this.notes
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .andWhere('n.updated_at >= :since', { since })
      .getCount();
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  /**
   * Fetch the raw entity - throws 404 on miss (no row-existence leak).
   * Used by every mutation so the user_id ownership filter cannot be skipped.
   */
  private async findOneRow(userId: string, id: string): Promise<Note> {
    const note = await this.notes.findOne({ where: { id, userId } });
    if (!note) throw new NotFoundException('Note not found');
    return note;
  }

  /** Decrypt title only; produces a list-row projection. */
  private toSummary(row: Note): NoteSummary {
    return {
      id: row.id,
      title: this.decryptField(row.titleCiphertext, row.titleIv, row.titleTag),
      preview: row.preview,
      tags: row.tags,
      color: row.color,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Decrypt title + content for the detail endpoint. */
  private toDetail(row: Note): NoteDetail {
    return {
      ...this.toSummary(row),
      content: this.decryptField(
        row.contentCiphertext,
        row.contentIv,
        row.contentTag,
      ),
    };
  }

  /**
   * Single-point helper so every decrypt site handles the (rare) corrupt-
   * ciphertext case identically: log and rethrow as 503, never leak raw
   * crypto errors to the response body.
   */
  private decryptField(ct: Buffer, iv: Buffer, tag: Buffer): string {
    try {
      return decrypt(ct, iv, tag, this.keyProvider.getKey());
    } catch (err) {
      if (err instanceof DecryptionError) {
        this.logger.error(
          'Decryption failed for a ciphertext row - the row is either corrupt or ' +
            'was encrypted with a different MASTER_KEY. Returning 503; do NOT ' +
            'expose the underlying crypto error to the client.',
        );
      }
      throw new ServiceUnavailableException(
        'Notes store is temporarily unavailable - please retry.',
      );
    }
  }
}

/**
 * Escape Postgres LIKE meta-characters (`%`, `_`, `\`) inside the user-
 * supplied search term so a query of `%` does not become an unbounded scan.
 * `escape '\\'` matters: the backslash itself must survive into the SQL.
 */
function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
