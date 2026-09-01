-- =============================================================================
-- lwaiwork - initial schema (reference / manual bootstrap)
--
-- In the MVP the schema is generated from the TypeORM entities by
-- `TYPEORM_SYNCHRONIZE=true`. This file is the human-readable equivalent:
--   * use it to bootstrap a fresh production database, and
--   * use it as the base for a versioned migration
--     (`npm run migration:generate -- migrations/InitSchema`).
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0001-init-schema.sql
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
    id            uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         varchar(320)                NOT NULL,
    name          varchar(120)                NOT NULL,
    password_hash varchar(255)                NOT NULL,
    created_at    timestamptz                NOT NULL DEFAULT now(),
    deleted_at    timestamptz                NULL,

    CONSTRAINT uq_users_email UNIQUE (email)
);

-- Enforce lower-cased emails so the unique index is meaningful.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

COMMENT ON COLUMN users.password_hash IS 'bcrypt hash (cost 12). Never serialised to clients.';
COMMENT ON COLUMN users.deleted_at    IS 'Soft delete marker (TypeORM @DeleteDateColumn).';

-- ---------------------------------------------------------------- todos
CREATE TABLE IF NOT EXISTS todos (
    id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid           NOT NULL,
    title       varchar(255)   NOT NULL,
    done        boolean        NOT NULL DEFAULT false,
    due_at      timestamptz    NULL,
    created_at  timestamptz    NOT NULL DEFAULT now(),
    updated_at  timestamptz    NOT NULL DEFAULT now(),
    deleted_at  timestamptz    NULL,

    CONSTRAINT fk_todos_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
);

-- Hot path: "list my todos" -> WHERE user_id = ? ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_todos_user_created ON todos (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_todos_user_id      ON todos (user_id);

COMMENT ON COLUMN todos.user_id    IS 'Owner. Every query MUST filter on it (per-user isolation).';
COMMENT ON COLUMN todos.deleted_at IS 'Soft delete marker. Queries must exclude non-null rows.';

-- ---------------------------------------------------------------- habits
CREATE TABLE IF NOT EXISTS habits (
    id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid           NOT NULL,
    name            varchar(64)    NOT NULL,
    color           varchar(16)    NOT NULL DEFAULT '#2FAF9E',
    icon            varchar(32)    NOT NULL DEFAULT 'check',
    frequency_type  varchar(16)    NOT NULL DEFAULT 'daily',
    frequency_days  int            NOT NULL DEFAULT 1,
    target_count    int            NOT NULL DEFAULT 1,
    archived_at     timestamptz    NULL,
    created_at      timestamptz    NOT NULL DEFAULT now(),
    updated_at      timestamptz    NOT NULL DEFAULT now(),

    CONSTRAINT fk_habits_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
);

-- Hot path 1: "list my active habits" -> WHERE user_id = ? AND archived_at IS NULL
CREATE INDEX IF NOT EXISTS idx_habits_user_archived ON habits (user_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_habits_user_id        ON habits (user_id);

COMMENT ON COLUMN habits.user_id         IS 'Owner. Every query MUST filter on it (per-user isolation).';
COMMENT ON COLUMN habits.frequency_type  IS 'daily | weekdays | custom | every_n_days. Drives streak algorithm.';
COMMENT ON COLUMN habits.frequency_days  IS 'Only used when frequency_type = every_n_days.';
COMMENT ON COLUMN habits.archived_at     IS 'Soft archive marker (NULL = active). Distinct from deleted_at: archived rows remain queryable for historical stats.';

-- ---------------------------------------------------------------- habit_logs
CREATE TABLE IF NOT EXISTS habit_logs (
    id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid           NOT NULL,
    habit_id    uuid           NOT NULL,
    date        date           NOT NULL,
    count       int            NOT NULL DEFAULT 1,
    note        varchar(255)   NULL,
    created_at  timestamptz    NOT NULL DEFAULT now(),

    CONSTRAINT fk_habit_logs_habit FOREIGN KEY (habit_id)
        REFERENCES habits (id) ON DELETE CASCADE,
    CONSTRAINT fk_habit_logs_user  FOREIGN KEY (user_id)
        REFERENCES users  (id) ON DELETE CASCADE,
    CONSTRAINT uq_habit_logs_habit_date UNIQUE (habit_id, date)
);

-- Hot paths: streak & heatmap queries
--   "WHERE user_id = ? AND habit_id = ? AND date BETWEEN ? AND ? ORDER BY date"
--   "WHERE user_id = ? AND date = ?       (today-completed list)"
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_date    ON habit_logs (user_id, date);
CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_date   ON habit_logs (habit_id, date);

COMMENT ON COLUMN habit_logs.user_id  IS 'Owner, denormalised for streak queries (avoids an extra join).';
COMMENT ON COLUMN habit_logs.date     IS 'UTC calendar day, YYYY-MM-DD. One row per (habit_id, date) by UNIQUE constraint.';
COMMENT ON COLUMN habit_logs.count    IS 'Number of unit check-ins on this day. habit completion = sum(count) >= habit.target_count.';

-- ---------------------------------------------------------------- notes
-- NOTE: appended at the 2026-09 milestone - older sections above are
-- preserved verbatim so re-applying this file is still idempotent.
--
-- Each note row stores AES-256-GCM ciphertext for title and content, one
-- (ct, iv, tag) triplet per field. The plaintext preview (~200 chars) is
-- the only thing exposed for list / search UX, so the encrypted body stays
-- closed to anyone with raw row access.
CREATE TABLE IF NOT EXISTS notes (
    id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid         NOT NULL,
    title_ciphertext    bytea        NOT NULL,
    title_iv            bytea        NOT NULL,                -- 12 bytes
    title_tag           bytea        NOT NULL,                -- 16 bytes
    content_ciphertext  bytea        NOT NULL,
    content_iv          bytea        NOT NULL,                -- 12 bytes
    content_tag         bytea        NOT NULL,                -- 16 bytes
    preview             varchar(200) NOT NULL,
    tags                text[]       NOT NULL DEFAULT '{}',
    color               varchar(16)  NOT NULL DEFAULT '#2FAF9E',
    archived_at         timestamptz  NULL,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT fk_notes_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
);

-- Hot path 1: "list my notes, newest edit first"
--   WHERE user_id = ? ORDER BY updated_at DESC
CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes (user_id, updated_at DESC);

-- Hot path 2: "list my active notes" - the default list filter hides archived.
-- Postgres SUPPORTS partial indexes; the second index covers exactly the
-- common "WHERE user_id = ? AND archived_at IS NULL" lookup without paying
-- for the cold archived rows in the main B-tree.
CREATE INDEX IF NOT EXISTS idx_notes_user_active
    ON notes (user_id)
    WHERE archived_at IS NULL;

-- Always filtered on the owner.
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes (user_id);

-- Tag filter uses array containment (`tags @> ARRAY[:tag]::text[]`); a GIN
-- index on the array keeps that query O(log N) instead of a full scan.
CREATE INDEX IF NOT EXISTS idx_notes_tags_gin ON notes USING GIN (tags);

-- Length sanity checks at the database layer. The application already enforces
-- these via DTO + the AES helper's byte caps, but defence-in-depth means we
-- also reject wrong-sized IVs / tags straight out of the database. A row with
-- iv != 12 bytes or tag != 16 bytes is unrecoverable - surface as a CHECK fail
-- rather than silently storing a malformed ciphertext.
ALTER TABLE notes
    ADD CONSTRAINT chk_notes_title_iv_len  CHECK (octet_length(title_iv)  = 12),
    ADD CONSTRAINT chk_notes_title_tag_len CHECK (octet_length(title_tag) = 16),
    ADD CONSTRAINT chk_notes_content_iv_len  CHECK (octet_length(content_iv)  = 12),
    ADD CONSTRAINT chk_notes_content_tag_len CHECK (octet_length(content_tag) = 16);

COMMENT ON COLUMN notes.user_id             IS 'Owner. Every query MUST filter on it (per-user isolation).';
COMMENT ON COLUMN notes.title_ciphertext    IS 'AES-256-GCM ciphertext of the plaintext title.';
COMMENT ON COLUMN notes.title_iv            IS '12-byte GCM IV. Fresh random per encrypt.';
COMMENT ON COLUMN notes.title_tag           IS '16-byte GCM auth tag for the title ciphertext.';
COMMENT ON COLUMN notes.content_ciphertext  IS 'AES-256-GCM ciphertext of the plaintext content.';
COMMENT ON COLUMN notes.content_iv          IS '12-byte GCM IV. Fresh random per encrypt.';
COMMENT ON COLUMN notes.content_tag         IS '16-byte GCM auth tag for the content ciphertext.';
COMMENT ON COLUMN notes.preview             IS 'Plaintext snippet (~200 chars) of content for list/search UX. NEVER the full body.';
COMMENT ON COLUMN notes.tags                IS 'Plaintext tags, small array. Indexed via GIN for the tag filter.';
COMMENT ON COLUMN notes.color               IS 'UI palette token (#RGB or #RRGGBB). Cosmetic only.';
COMMENT ON COLUMN notes.archived_at         IS 'Soft archive marker (NULL = active). Archived rows are hidden from the default list view.';

-- ---------------------------------------------------------------- schedules
-- NOTE: appended at the 2026-09 milestone - older sections above are
-- preserved verbatim so re-applying this file is still idempotent.
--
-- Schedules implement single + recurring calendar events. Times are stored
-- in UTC (TIMESTAMPTZ); the user-supplied IANA timezone is kept on the row
-- so the RRULE engine can pin "9am every day" to local time across DST.
--
-- The on-disk rrule string NEVER carries a DTSTART - the column
-- `start_at` is the canonical source for that, which keeps DRY simple.
CREATE TABLE IF NOT EXISTS schedules (
    id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid           NOT NULL,
    title             varchar(200)   NOT NULL,
    description       text           NULL,
    start_at          timestamptz    NOT NULL,
    end_at            timestamptz    NULL,
    timezone          varchar(64)    NOT NULL,
    all_day           boolean        NOT NULL DEFAULT false,
    rrule             text           NULL,
    exdates           timestamptz[]  NOT NULL DEFAULT '{}',
    location          varchar(200)   NULL,
    reminder_minutes  int[]          NOT NULL DEFAULT '{}',
    color             varchar(16)    NOT NULL DEFAULT '#2FAF9E',
    archived_at       timestamptz    NULL,
    created_at        timestamptz    NOT NULL DEFAULT now(),
    updated_at        timestamptz    NOT NULL DEFAULT now(),

    CONSTRAINT fk_schedules_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
);

-- Hot path 1: list-window query "WHERE user_id = ? AND start_at < ? ORDER BY start_at ASC".
CREATE INDEX IF NOT EXISTS idx_schedules_user_start      ON schedules (user_id, start_at);
-- Hot path 2: default list hides archived - partial index keeps the active rows cheap.
CREATE INDEX IF NOT EXISTS idx_schedules_user_archived   ON schedules (user_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_schedules_user_id          ON schedules (user_id);

COMMENT ON COLUMN schedules.user_id          IS 'Owner. Every query MUST filter on it (per-user isolation).';
COMMENT ON COLUMN schedules.start_at         IS 'Canonical first-instance start (UTC). Also reused as DTSTART in the rrule engine - we never duplicate it inside rrule.';
COMMENT ON COLUMN schedules.end_at           IS 'Optional single-instance end. NULL = open-ended start-only event.';
COMMENT ON COLUMN schedules.timezone         IS 'IANA timezone id (e.g. Asia/Shanghai). Drives rrule local-time expansion; never shifts start_at, which stays absolute UTC.';
COMMENT ON COLUMN schedules.all_day          IS 'UI hint: render a day-level chip instead of a clock. start_at remains the timestamp.';
COMMENT ON COLUMN schedules.rrule            IS 'RRULE string WITHOUT a DTSTART prefix. NULL = single event. The expansion engine merges it with start_at + timezone.';
COMMENT ON COLUMN schedules.exdates          IS 'Blacklisted instance starts. Each is a UTC moment. Skipped during window expansion.';
COMMENT ON COLUMN schedules.reminder_minutes IS 'Minutes BEFORE start_at. Empty array = no reminder. Push delivery is a later milestone; M2 only stores it.';
COMMENT ON COLUMN schedules.color            IS 'UI palette token (#RGB or #RRGGBB). Defaults to teal like habits/notes.';
COMMENT ON COLUMN schedules.archived_at      IS 'Soft archive marker (NULL = active). Use plain nullable column (NOT @DeleteDateColumn) so un-archive is symmetric.';

-- ---------------------------------------------------------------- schedule_overrides
-- Per-instance edits. Composite PK by (schedule_id, instance_start_at) is
-- also the lookup index for window expansion (O(log N) point-reads per
-- occurrence). The original `instance_start_at` is the identity even when
-- an override moves the visible start_at to a different time.
--
-- We CASCADE on schedule delete so hard-deleting a schedule removes its
-- overrides in the same transaction; soft-archive keeps everything around.
CREATE TABLE IF NOT EXISTS schedule_overrides (
    schedule_id        uuid           NOT NULL,
    instance_start_at  timestamptz    NOT NULL,
    title              varchar(200)   NULL,
    description        text           NULL,
    start_at           timestamptz    NULL,
    end_at             timestamptz    NULL,
    all_day            boolean        NULL,
    location           varchar(200)   NULL,
    reminder_minutes   int[]          NULL,
    truncate           boolean        NOT NULL DEFAULT false,

    PRIMARY KEY (schedule_id, instance_start_at),
    CONSTRAINT fk_schedule_overrides_schedule FOREIGN KEY (schedule_id)
        REFERENCES schedules (id) ON DELETE CASCADE
);

-- Series-level filter (e.g. "all overrides for this schedule") uses this
-- index - Postgres' planner ignores the second PK column for such queries.
CREATE INDEX IF NOT EXISTS idx_schedule_overrides_schedule_start
    ON schedule_overrides (schedule_id, instance_start_at);

COMMENT ON COLUMN schedule_overrides.schedule_id       IS 'FK to schedules.id. Cascades on hard delete of the series.';
COMMENT ON COLUMN schedule_overrides.instance_start_at IS 'Original occurrence time. Stays stable even when the override moves the visible start_at.';
COMMENT ON COLUMN schedule_overrides.title             IS 'Override of the instance title. NULL = inherit series.';
COMMENT ON COLUMN schedule_overrides.description       IS 'Override of the instance description. NULL = inherit series.';
COMMENT ON COLUMN schedule_overrides.start_at          IS 'Override of the instance startAt (UTC). NULL = stay where the series put me.';
COMMENT ON COLUMN schedule_overrides.end_at            IS 'Override of the instance endAt. NULL = inherit series.';
COMMENT ON COLUMN schedule_overrides.all_day           IS 'Override of allDay. NULL = inherit series.';
COMMENT ON COLUMN schedule_overrides.location          IS 'Override of location. NULL = inherit series.';
COMMENT ON COLUMN schedule_overrides.reminder_minutes  IS 'Override of reminder minutes. NULL = inherit series.';
COMMENT ON COLUMN schedule_overrides.truncate          IS '"This and future" tombstone. When set, the expansion engine stops emitting further instances from this schedule.';

COMMIT;
