-- migrate:up

CREATE TABLE players (
  id text PRIMARY KEY,
  display_name text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE provider_identity_mappings (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  subject text NOT NULL,
  display_name text,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  CONSTRAINT provider_identity_mappings_unique_provider_subject UNIQUE (provider, subject),
  CONSTRAINT provider_identity_mappings_provider_not_blank CHECK (length(trim(provider)) > 0),
  CONSTRAINT provider_identity_mappings_subject_not_blank CHECK (length(trim(subject)) > 0)
);

CREATE INDEX provider_identity_mappings_player_id
  ON provider_identity_mappings (player_id);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT sessions_status_valid CHECK (status IN ('active', 'expired')),
  CONSTRAINT sessions_expiry_after_create CHECK (expires_at > created_at)
);

CREATE INDEX sessions_player_status_expires_at
  ON sessions (player_id, status, expires_at);

CREATE INDEX sessions_status_expires_at
  ON sessions (status, expires_at);

CREATE INDEX sessions_created_at
  ON sessions (created_at);

-- migrate:down

DROP INDEX IF EXISTS sessions_created_at;
DROP INDEX IF EXISTS sessions_status_expires_at;
DROP INDEX IF EXISTS sessions_player_status_expires_at;
DROP TABLE IF EXISTS sessions;
DROP INDEX IF EXISTS provider_identity_mappings_player_id;
DROP TABLE IF EXISTS provider_identity_mappings;
DROP TABLE IF EXISTS players;