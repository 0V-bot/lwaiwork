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

COMMIT;
