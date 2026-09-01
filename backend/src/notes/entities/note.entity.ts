import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One row per note, owned by exactly one user (`user_id`).
 *
 * Encryption layout (see `crypto-aes-gcm.ts` for the primitives):
 *   * `title_ciphertext` / `title_iv` / `title_tag`     - AES-256-GCM(title)
 *   * `content_ciphertext` / `content_iv` / `content_tag` - AES-256-GCM(content)
 *
 * Every field has its own 12-byte IV. Reusing an IV across encryptions is
 * the textbook GCM mistake (catastrophic keystream reuse); we always pull
 * a fresh random IV per call from the helper.
 *
 * Plaintext fields (intentional - low sensitivity + search UX):
 *   * `preview`   - first ~200 chars of content, whitespace-collapsed.
 *                   Backs list view + the `POST /notes/search` endpoint.
 *                   NEVER the full content; that stays in ciphertext.
 *   * `tags`      - small array of user-supplied labels. Same rationale.
 *   * `color`     - UI palette token. Purely cosmetic.
 *
 * SECURITY: the FK on `user_id` (declared in migration `0001-init-schema.sql`)
 * guarantees row-level isolation at the database layer. Even a buggy
 * application query that forgets the WHERE clause cannot surface another
 * tenant's ciphertext - the FK + ON DELETE CASCADE also make sure that
 * when a user is hard-deleted (rare, but possible after GDPR export) all
 * their ciphertexts are wiped from disk in one round-trip.
 */
@Entity({ name: 'notes' })
@Index('IDX_notes_user_updated', ['userId', 'updatedAt'])
// 部分索引 `WHERE archived_at IS NULL` 在 PG 上 emit 的 SQL 被加了反引号
// （"syntax error at or near NULL"），导致 synchronize 失败 → backend 重启循环。
// 这条索引对本模块不是必需的：`IDX_notes_user_updated` (user_id, updated_at) 已
// 加速默认列表；includeArchived=true 的全量分页是低频路径。
// 后续若需要大表优化，走 migration 加 `CREATE INDEX ... WHERE archived_at IS NULL`。
export class Note {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Owner. Every NotesService method folds this into the WHERE clause / payload
   * (same security invariant as TodosService and HabitsService). Never derived
   * from the request body - always from the validated JWT.
   */
  @Column({ name: 'user_id', type: 'uuid' })
  @Index('IDX_notes_user_id')
  userId!: string;

  // ---------------------------------------------------------------- encrypted title
  @Column({ name: 'title_ciphertext', type: 'bytea' })
  titleCiphertext!: Buffer;

  @Column({ name: 'title_iv', type: 'bytea' })
  titleIv!: Buffer;

  @Column({ name: 'title_tag', type: 'bytea' })
  titleTag!: Buffer;

  // ---------------------------------------------------------------- encrypted content
  @Column({ name: 'content_ciphertext', type: 'bytea' })
  contentCiphertext!: Buffer;

  @Column({ name: 'content_iv', type: 'bytea' })
  contentIv!: Buffer;

  @Column({ name: 'content_tag', type: 'bytea' })
  contentTag!: Buffer;

  // ---------------------------------------------------------------- plaintext metadata
  @Column({ type: 'varchar', length: 200 })
  preview!: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags!: string[];

  @Column({ type: 'varchar', length: 16, default: '#2FAF9E' })
  color!: string;

  // ---------------------------------------------------------------- lifecycle
  /**
   * Soft archive. We use a plain nullable Column (NOT @DeleteDateColumn) for
   * the same reason Habit.archivedAt is a plain column: archived notes must
   * stay queryable so the user can un-archive and find them again, and the
   * list endpoint controls visibility by filtering `archived_at IS NULL`.
   *
   * DELETE /notes/:id flips this to `now()`.
   */
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
