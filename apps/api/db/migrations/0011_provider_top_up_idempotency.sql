-- migrate:up

CREATE TYPE provider_top_up_idempotency_status AS ENUM ('pending', 'completed', 'failed', 'ignored', 'duplicate');

CREATE TABLE provider_top_up_idempotency_records (
  id text PRIMARY KEY,
  provider_name text NOT NULL,
  provider_event_id text NOT NULL,
  normalized_idempotency_key text NOT NULL,
  player_id text REFERENCES players(id) ON DELETE RESTRICT,
  status provider_top_up_idempotency_status NOT NULL,
  point_amount bigint,
  points_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  completed_at timestamptz,
  failure_reason text,
  CONSTRAINT provider_top_up_unique_event UNIQUE (provider_name, provider_event_id),
  CONSTRAINT provider_top_up_unique_key UNIQUE (provider_name, normalized_idempotency_key),
  CONSTRAINT provider_top_up_non_negative_points CHECK (point_amount IS NULL OR point_amount >= 0),
  CONSTRAINT provider_top_up_safe_points CHECK (point_amount IS NULL OR point_amount <= 9007199254740991),
  CONSTRAINT provider_top_up_completed_has_timestamp CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  CONSTRAINT provider_top_up_failed_has_reason CHECK (status <> 'failed' OR failure_reason IS NOT NULL),
  CONSTRAINT provider_top_up_duplicate_has_reason CHECK (status <> 'duplicate' OR failure_reason IS NOT NULL)
);

CREATE INDEX provider_top_up_status_seen_idx ON provider_top_up_idempotency_records (provider_name, status, last_seen_at DESC, id DESC);
CREATE INDEX provider_top_up_player_seen_idx ON provider_top_up_idempotency_records (player_id, last_seen_at DESC, id DESC) WHERE player_id IS NOT NULL;
CREATE INDEX provider_top_up_completed_idx ON provider_top_up_idempotency_records (completed_at DESC, id DESC) WHERE completed_at IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS provider_top_up_completed_idx;
DROP INDEX IF EXISTS provider_top_up_player_seen_idx;
DROP INDEX IF EXISTS provider_top_up_status_seen_idx;
DROP TABLE IF EXISTS provider_top_up_idempotency_records;
DROP TYPE IF EXISTS provider_top_up_idempotency_status;
