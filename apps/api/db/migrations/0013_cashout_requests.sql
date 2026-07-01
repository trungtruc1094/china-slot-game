-- migrate:up

CREATE TYPE cashout_request_status AS ENUM (
  'pending',
  'dispatched',
  'failed_retryable',
  'failed_terminal',
  'idempotency_conflict'
);

CREATE TABLE cashout_requests (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  tevi_subject text NOT NULL,
  amount bigint NOT NULL,
  wallet_transaction_id text NOT NULL REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  payload_fingerprint text NOT NULL,
  status cashout_request_status NOT NULL,
  dispatch_attempt_count integer NOT NULL DEFAULT 0,
  failure_reason text,
  provider_status_code integer,
  provider_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  CONSTRAINT cashout_requests_amount_positive CHECK (amount > 0),
  CONSTRAINT cashout_requests_amount_safe CHECK (amount <= 9007199254740991),
  CONSTRAINT cashout_requests_idempotency_key_unique UNIQUE (idempotency_key),
  CONSTRAINT cashout_requests_failed_has_reason CHECK (
    status NOT IN ('failed_retryable', 'failed_terminal', 'idempotency_conflict') OR failure_reason IS NOT NULL
  )
);

CREATE INDEX cashout_requests_player_created_idx ON cashout_requests (player_id, created_at DESC, id DESC);
CREATE INDEX cashout_requests_request_id_idx ON cashout_requests (request_id);
CREATE INDEX cashout_requests_status_created_idx ON cashout_requests (status, created_at DESC, id DESC);

-- migrate:down

DROP INDEX IF EXISTS cashout_requests_status_created_idx;
DROP INDEX IF EXISTS cashout_requests_request_id_idx;
DROP INDEX IF EXISTS cashout_requests_player_created_idx;
DROP TABLE IF EXISTS cashout_requests;
DROP TYPE IF EXISTS cashout_request_status;
