-- migrate:up

CREATE TYPE alert_metric AS ENUM ('observedRtpAbove', 'observedRtpBelow', 'remainingBudgetBelow', 'jackpotLiabilityAbove');
CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE alert_status AS ENUM ('firing', 'resolved', 'acknowledged');

CREATE TABLE alert_rules (
  id text PRIMARY KEY,
  scope_id text NOT NULL,
  metric alert_metric NOT NULL,
  threshold numeric NOT NULL,
  severity alert_severity NOT NULL,
  suggested_action text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT alert_rules_threshold_non_negative CHECK (threshold >= 0)
);

CREATE TABLE alert_history (
  id text PRIMARY KEY,
  rule_id text NOT NULL REFERENCES alert_rules(id),
  scope_id text NOT NULL,
  evaluation_key text NOT NULL,
  status alert_status NOT NULL,
  metric alert_metric NOT NULL,
  metric_value numeric NOT NULL,
  threshold numeric NOT NULL,
  window_start_at timestamptz,
  window_end_at timestamptz,
  severity alert_severity NOT NULL,
  suggested_action text NOT NULL,
  actor text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX alert_history_idempotency
  ON alert_history (rule_id, evaluation_key, status);

CREATE INDEX alert_history_scope_status_created_at
  ON alert_history (scope_id, status, created_at);

CREATE INDEX alert_history_rule_window
  ON alert_history (rule_id, window_start_at, window_end_at);

-- migrate:down

DROP INDEX IF EXISTS alert_history_rule_window;
DROP INDEX IF EXISTS alert_history_scope_status_created_at;
DROP INDEX IF EXISTS alert_history_idempotency;
DROP TABLE IF EXISTS alert_history;
DROP TABLE IF EXISTS alert_rules;
DROP TYPE IF EXISTS alert_status;
DROP TYPE IF EXISTS alert_severity;
DROP TYPE IF EXISTS alert_metric;
