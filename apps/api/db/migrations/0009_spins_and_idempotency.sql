-- migrate:up

CREATE TYPE spin_idempotency_status AS ENUM ('pending', 'completed');

CREATE TABLE spin_idempotency_keys (
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  client_spin_id text NOT NULL,
  player_id text REFERENCES players(id) ON DELETE RESTRICT,
  wager_fingerprint text NOT NULL,
  status spin_idempotency_status NOT NULL,
  response_json jsonb,
  request_id text,
  correlation_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (session_id, client_spin_id),
  CONSTRAINT spin_idempotency_completed_has_response CHECK (status <> 'completed' OR (response_json IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE TABLE spins (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  player_id text NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  client_spin_id text NOT NULL,
  config_version_id text NOT NULL,
  wager_json jsonb NOT NULL,
  reel_stops_json jsonb NOT NULL,
  visible_window_json jsonb NOT NULL,
  win_breakdown_json jsonb NOT NULL,
  payout bigint NOT NULL,
  balance_after bigint NOT NULL,
  free_spins_awarded integer NOT NULL,
  free_spins_remaining integer NOT NULL,
  jackpot_award bigint NOT NULL,
  response_json jsonb NOT NULL,
  request_id text,
  correlation_id text,
  accepted_at timestamptz NOT NULL,
  CONSTRAINT spins_unique_session_client_spin UNIQUE (session_id, client_spin_id),
  CONSTRAINT spins_non_negative_amounts CHECK (payout >= 0 AND balance_after >= 0 AND jackpot_award >= 0),
  CONSTRAINT spins_safe_amounts CHECK (payout <= 9007199254740991 AND balance_after <= 9007199254740991 AND jackpot_award <= 9007199254740991)
);

CREATE TABLE spin_wallet_transactions (
  spin_id text NOT NULL REFERENCES spins(id) ON DELETE RESTRICT,
  wallet_transaction_id text NOT NULL REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
  transaction_type wallet_transaction_type NOT NULL,
  PRIMARY KEY (spin_id, wallet_transaction_id)
);

CREATE INDEX spins_player_accepted_idx ON spins (player_id, accepted_at DESC, id DESC);
CREATE INDEX spins_session_accepted_idx ON spins (session_id, accepted_at DESC, id DESC);
CREATE INDEX spins_client_spin_idx ON spins (client_spin_id);
CREATE INDEX spins_config_accepted_idx ON spins (config_version_id, accepted_at DESC, id DESC);
CREATE INDEX spins_request_id_idx ON spins (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX spins_correlation_id_idx ON spins (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX spins_payout_idx ON spins (payout);

-- migrate:down

DROP INDEX IF EXISTS spins_payout_idx;
DROP INDEX IF EXISTS spins_correlation_id_idx;
DROP INDEX IF EXISTS spins_request_id_idx;
DROP INDEX IF EXISTS spins_config_accepted_idx;
DROP INDEX IF EXISTS spins_client_spin_idx;
DROP INDEX IF EXISTS spins_session_accepted_idx;
DROP INDEX IF EXISTS spins_player_accepted_idx;
DROP TABLE IF EXISTS spin_wallet_transactions;
DROP TABLE IF EXISTS spins;
DROP TABLE IF EXISTS spin_idempotency_keys;
DROP TYPE IF EXISTS spin_idempotency_status;