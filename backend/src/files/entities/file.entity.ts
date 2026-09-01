import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One row per uploaded file, owned by exactly one user (`user_id`).
 *
 * Lifecycle:
 *   * POST /files/upload-ticket validates the request + reserves an `ossKey`,
 *     but the row does NOT yet exist on disk - the client then PUTs the bytes
 *     to OSS and POST /files/confirm creates the row from the OSS response.
 *   * DELETE /files/:id soft-archives (sets `archived_at`); the row stays
 *     in PostgreSQL for un-archive UX, but the underlying OSS object is
 *     removed immediately so the bucket doesn't accumulate orphan objects
 *     (the OSS lifecycle rule is a belt-and-braces).
 *
 * SECURITY:
 *   * `ossKey` is the path inside the bucket: `users/${userId}/${uuid}.${ext}`.
 *     The prefix is the row's tenant boundary - confirm-upload checks that
 *     ossKey.startsWith('users/${userId}/') to prevent a peer from sneaking
 *     a different user's ticket into our DB.
 *   * `ossBucket` is denormalised so a future bucket-migration can be
 *     reasoned about row-by-row (currently always "lwaiwork").
 *   * The FK on `user_id` (see migration) cascades on user hard-delete, so
 *     GDPR-style account wipes take the file rows with them. The OSS
 *     objects are best-effort cleaned via the same delete path (logged,
 *     never thrown) - OSS is the source of truth for blobs.
 */
@Entity({ name: 'files' })
@Index('IDX_files_user_updated', ['userId', 'updatedAt'])
export class FileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Owner. Always sourced from the validated JWT principal; never from the
   * request body. Same invariant as NotesService / SchedulesService /
   * HabitsService / TodosService.
   */
  @Column({ name: 'user_id', type: 'uuid' })
  @Index('IDX_files_user_id')
  userId!: string;

  /** Original filename, as the client asked us to store it. */
  @Column({ type: 'varchar', length: 255 })
  filename!: string;

  /** MIME the client declared + we re-validated against the whitelist. */
  @Column({ name: 'content_type', type: 'varchar', length: 127 })
  contentType!: string;

  /** Final on-disk size as reported by OSS in the confirm step. */
  @Column({ type: 'bigint', transformer: { to: (v) => v, from: (v) => Number(v) } })
  size!: number;

  /**
   * Full OSS object key (path inside the bucket). Globally UNIQUE because
   * two rows pointing at the same OSS object would be impossible to reason
   * about under deletes. Format: `users/${userId}/${uuid}.${ext}`.
   */
  @Column({ name: 'oss_key', type: 'varchar', length: 255, unique: true })
  ossKey!: string;

  /** Bucket name (always "lwaiwork" today; kept on-row for forward-compat). */
  @Column({ name: 'oss_bucket', type: 'varchar', length: 64 })
  ossBucket!: string;

  /** ETag the OSS PUT response gave us. Stored verbatim (hex + quotes). */
  @Column({ type: 'varchar', length: 64 })
  etag!: string;

  /** True for `image/*` content types; flips the UI to a thumbnail renderer. */
  @Column({ name: 'is_image', type: 'boolean', default: false })
  isImage!: boolean;

  /** Pixel width. Nullable: only meaningful when `isImage === true`. */
  @Column({ type: 'int', nullable: true })
  width!: number | null;

  /** Pixel height. Nullable: only meaningful when `isImage === true`. */
  @Column({ type: 'int', nullable: true })
  height!: number | null;

  /**
   * Soft archive marker. Stored on a plain nullable column (NOT
   * @DeleteDateColumn) for the same reason Notes and Schedules use plain
   * columns: archive must be reversible and the row must remain queryable.
   * DELETE /files/:id flips this and removes the OSS object; the row stays
   * for the duration of the user's history.
   */
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
