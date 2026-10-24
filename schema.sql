-- Runs once, the first time the database volume is created.

CREATE TABLE users (
    id            serial PRIMARY KEY,
    username      text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    failed_logins integer NOT NULL DEFAULT 0,
    locked_until  timestamptz,
    last_login    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);

CREATE TABLE entries (
    id         serial PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lab        smallint CHECK (lab BETWEEN 1 AND 10),
    title      text NOT NULL,
    body       text NOT NULL DEFAULT '',
    tags       text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- full-text index: title weighs more than body
    search     tsvector GENERATED ALWAYS AS (
                   setweight(to_tsvector('english', title), 'A') ||
                   setweight(to_tsvector('english', body), 'B')
               ) STORED
);

CREATE INDEX entries_user_idx   ON entries (user_id, created_at DESC);
CREATE INDEX entries_search_idx ON entries USING gin (search);
CREATE INDEX entries_tags_idx   ON entries USING gin (tags);

CREATE TABLE lab_progress (
    user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lab        smallint NOT NULL CHECK (lab BETWEEN 1 AND 10),
    status     text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, lab)
);

CREATE TABLE audit_log (
    id         bigserial PRIMARY KEY,
    user_id    integer REFERENCES users(id) ON DELETE SET NULL,
    username   text,
    event      text NOT NULL,
    ip         text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_user_idx ON audit_log (user_id, created_at DESC);
