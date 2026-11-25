BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY,email text UNIQUE NOT NULL,hash text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token text PRIMARY KEY,owner text NOT NULL REFERENCES users,expires bigint NOT NULL);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS items(id text PRIMARY KEY, owner text NOT NULL REFERENCES users,url text NOT NULL,title text NOT NULL,domain text NOT NULL,capture_type text NOT NULL,captured_at text NOT NULL,created_at text NOT NULL,kind text NOT NULL,picture text,selected_text text,source_url text,capture_key text NOT NULL,picture_url text,kind_mode text NOT NULL,UNIQUE(owner,capture_key));
CREATE INDEX IF NOT EXISTS collection ON items(owner,created_at DESC,id);
CREATE TABLE IF NOT EXISTS request_limits(key text PRIMARY KEY, count integer NOT NULL, until_ms bigint NOT NULL);
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS verification(
 email text PRIMARY KEY, challenge uuid NOT NULL UNIQUE, password_hash text NOT NULL,
 proof text NOT NULL, expires timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0
);
COMMIT;
