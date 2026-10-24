-- Runs once, the first time the database volume is created.

CREATE TABLE users (
    id            serial PRIMARY KEY,
    username      text NOT NULL UNIQUE,
    password_hash text NOT NULL,
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
    lab        smallint,
    title      text NOT NULL,
    body       text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX entries_user_idx ON entries (user_id, created_at DESC);
