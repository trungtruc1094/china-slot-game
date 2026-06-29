-- migrate:up

CREATE TYPE topup_signature_issuance_status AS ENUM ('issued', 'failed');

CREATE TABLE topup_signature_issuances (
  id text PRIMARY KEY,
  provider_name text NOT NULL,
  player_id text REFERENCES players(id) ON DELETE RESTRICT,
  tevi_subject text,
  amount bigint,
  request_id text NOT NULL,
  deposit_token_fingerprint text,
  status topup_signature_issuance_status NOT NULL,
  failure_reason text,
  provider_status_code integer,
  provider_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  CONSTRAINT topup_signature_amount_positive CHECK (amount IS NULL OR amount > 0),
  CONSTRAINT topup_signature_amount_safe CHECK (amount IS NULL OR amount <= 9007199254740991),
  CONSTRAINT topup_signature_issued_has_fingerprint CHECK (status <> 'issued' OR deposit_token_fingerprint IS NOT NULL),
  CONSTRAINT topup_signature_failed_has_reason CHECK (status <> 'failed' OR failure_reason IS NOT NULL),
  CONSTRAINT topup_signature_no_failed_fingerprint CHECK (status <> 'failed' OR deposit_token_fingerprint IS NULL)
);

CREATE INDEX topup_signature_player_created_idx ON topup_signature_issuances (player_id, created_at DESC, id DESC) WHERE player_id IS NOT NULL;
CREATE INDEX topup_signature_request_idx ON topup_signature_issuances (request_id, created_at DESC, id DESC);
CREATE INDEX topup_signature_status_created_idx ON topup_signature_issuances (provider_name, status, created_at DESC, id DESC);

-- migrate:down

DROP INDEX IF EXISTS topup_signature_status_created_idx;
DROP INDEX IF EXISTS topup_signature_request_idx;
DROP INDEX IF EXISTS topup_signature_player_created_idx;
DROP TABLE IF EXISTS topup_signature_issuances;
DROP TYPE IF EXISTS topup_signature_issuance_status;
