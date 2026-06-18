-- migrate:up

CREATE TABLE operator_metric_buckets (
  bucket_start_at timestamptz NOT NULL,
  bucket_size_seconds integer NOT NULL,
  scope_id text NOT NULL,
  config_version_id text NOT NULL,
  total_wagered_minor integer NOT NULL,
  total_paid_minor integer NOT NULL,
  spin_count integer NOT NULL,
  hit_count integer NOT NULL,
  player_count integer NOT NULL,
  active_session_count integer NOT NULL,
  jackpot_liability_minor integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (bucket_start_at, bucket_size_seconds, scope_id, config_version_id),
  CONSTRAINT operator_metric_buckets_positive_bucket CHECK (bucket_size_seconds > 0),
  CONSTRAINT operator_metric_buckets_non_negative_values CHECK (
    total_wagered_minor >= 0
    AND total_paid_minor >= 0
    AND spin_count >= 0
    AND hit_count >= 0
    AND player_count >= 0
    AND active_session_count >= 0
    AND jackpot_liability_minor >= 0
  )
);

CREATE INDEX operator_metric_buckets_scope_bucket
  ON operator_metric_buckets (scope_id, bucket_start_at);

CREATE INDEX operator_metric_buckets_config_bucket
  ON operator_metric_buckets (config_version_id, bucket_start_at);

-- migrate:down

DROP INDEX IF EXISTS operator_metric_buckets_config_bucket;
DROP INDEX IF EXISTS operator_metric_buckets_scope_bucket;
DROP TABLE IF EXISTS operator_metric_buckets;
