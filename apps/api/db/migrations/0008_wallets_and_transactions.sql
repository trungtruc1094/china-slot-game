-- migrate:up

CREATE TYPE wallet_transaction_type AS ENUM ('debit', 'credit', 'free_spin_award', 'jackpot_award', 'adjustment');

CREATE TABLE wallets (
  player_id text PRIMARY KEY REFERENCES players(id) ON DELETE RESTRICT,
  balance bigint NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT wallets_non_negative_balance CHECK (balance >= 0),
  CONSTRAINT wallets_safe_balance CHECK (balance <= 9007199254740991)
);

CREATE TABLE wallet_transactions (
  id text PRIMARY KEY,
  sequence_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  player_id text NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  transaction_type wallet_transaction_type NOT NULL,
  amount bigint NOT NULL,
  balance_before bigint NOT NULL,
  balance_after bigint NOT NULL,
  actor text NOT NULL,
  source text NOT NULL,
  correlation_id text,
  spin_id text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  CONSTRAINT wallet_transactions_positive_amount CHECK (amount > 0),
  CONSTRAINT wallet_transactions_safe_amount CHECK (amount <= 9007199254740991),
  CONSTRAINT wallet_transactions_non_negative_balances CHECK (balance_before >= 0 AND balance_after >= 0),
  CONSTRAINT wallet_transactions_safe_balances CHECK (balance_before <= 9007199254740991 AND balance_after <= 9007199254740991),
  CONSTRAINT wallet_transactions_balance_delta CHECK (
    (transaction_type = 'debit' AND balance_after = balance_before - amount)
    OR (transaction_type <> 'debit' AND balance_after = balance_before + amount)
  )
);

CREATE INDEX wallet_transactions_player_created_idx
  ON wallet_transactions (player_id, created_at DESC, sequence_number DESC);

CREATE INDEX wallet_transactions_type_created_idx
  ON wallet_transactions (transaction_type, created_at DESC, sequence_number DESC);

CREATE INDEX wallet_transactions_source_created_idx
  ON wallet_transactions (source, created_at DESC, sequence_number DESC);

CREATE INDEX wallet_transactions_spin_id_idx
  ON wallet_transactions (spin_id)
  WHERE spin_id IS NOT NULL;

CREATE INDEX wallet_transactions_correlation_id_idx
  ON wallet_transactions (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS wallet_transactions_correlation_id_idx;
DROP INDEX IF EXISTS wallet_transactions_spin_id_idx;
DROP INDEX IF EXISTS wallet_transactions_source_created_idx;
DROP INDEX IF EXISTS wallet_transactions_type_created_idx;
DROP INDEX IF EXISTS wallet_transactions_player_created_idx;
DROP TABLE IF EXISTS wallet_transactions;
DROP TABLE IF EXISTS wallets;
DROP TYPE IF EXISTS wallet_transaction_type;