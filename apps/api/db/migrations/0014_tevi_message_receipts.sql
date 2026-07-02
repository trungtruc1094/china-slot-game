-- migrate:up

CREATE TYPE tevi_message_receipt_type AS ENUM ('topup_credit', 'cashout_dispatch');

CREATE TYPE tevi_message_receipt_status AS ENUM ('pending', 'sent', 'failed_retryable', 'failed_terminal');

CREATE TABLE tevi_message_receipt_records (
  id text PRIMARY KEY,
  message_type tevi_message_receipt_type NOT NULL,
  recipient_tevi_subject text NOT NULL,
  player_id text REFERENCES players(id) ON DELETE RESTRICT,
  source_event_id text NOT NULL,
  source_correlation_key text NOT NULL,
  amount bigint,
  cashout_status text,
  status tevi_message_receipt_status NOT NULL,
  dispatch_attempt_count integer NOT NULL DEFAULT 0,
  failure_reason text,
  provider_status_code integer,
  provider_response_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  message_body_preview text NOT NULL,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  sent_at timestamptz,
  CONSTRAINT tevi_message_receipts_source_unique UNIQUE (message_type, source_correlation_key),
  CONSTRAINT tevi_message_receipts_amount_safe CHECK (amount IS NULL OR (amount > 0 AND amount <= 9007199254740991)),
  CONSTRAINT tevi_message_receipts_failed_has_reason CHECK (
    status NOT IN ('failed_retryable', 'failed_terminal') OR failure_reason IS NOT NULL
  )
);

CREATE INDEX tevi_message_receipts_player_created_idx
  ON tevi_message_receipt_records (player_id, created_at DESC, id DESC)
  WHERE player_id IS NOT NULL;

CREATE INDEX tevi_message_receipts_type_status_created_idx
  ON tevi_message_receipt_records (message_type, status, created_at DESC, id DESC);

CREATE INDEX tevi_message_receipts_source_event_idx
  ON tevi_message_receipt_records (source_event_id);

-- migrate:down

DROP INDEX IF EXISTS tevi_message_receipts_source_event_idx;
DROP INDEX IF EXISTS tevi_message_receipts_type_status_created_idx;
DROP INDEX IF EXISTS tevi_message_receipts_player_created_idx;
DROP TABLE IF EXISTS tevi_message_receipt_records;
DROP TYPE IF EXISTS tevi_message_receipt_status;
DROP TYPE IF EXISTS tevi_message_receipt_type;
