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

COMMIT;
