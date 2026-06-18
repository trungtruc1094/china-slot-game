-- migrate:up

CREATE TYPE operator_limit_status AS ENUM ('active', 'retired');

CREATE TABLE operator_limits (
  id text PRIMARY KEY,
  scope_id text NOT NULL,
  version integer NOT NULL,
  status operator_limit_status NOT NULL,
  currency text NOT NULL,
  per_spin_min_bet_minor integer NOT NULL,
  per_spin_max_bet_minor integer NOT NULL,
  per_spin_max_payout_minor integer NOT NULL,
  per_session_max_spins integer NOT NULL,
  per_session_max_wager_minor integer NOT NULL,
  per_day_player_max_wager_minor integer NOT NULL,
  per_day_player_max_reward_minor integer NOT NULL,
  campaign_budget_minor integer NOT NULL,
  campaign_jackpot_cap_minor integer NOT NULL,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT operator_limits_scope_version_unique UNIQUE (scope_id, version),
  CONSTRAINT operator_limits_positive_values CHECK (
    per_spin_min_bet_minor > 0
    AND per_spin_max_bet_minor > 0
    AND per_spin_max_payout_minor > 0
    AND per_session_max_spins > 0
    AND per_session_max_wager_minor > 0
    AND per_day_player_max_wager_minor > 0
    AND per_day_player_max_reward_minor > 0
    AND campaign_budget_minor > 0
    AND campaign_jackpot_cap_minor > 0
  ),
  CONSTRAINT operator_limits_possible_combinations CHECK (
    per_spin_min_bet_minor <= per_spin_max_bet_minor
    AND per_spin_max_payout_minor <= campaign_jackpot_cap_minor
    AND per_spin_max_bet_minor <= per_session_max_wager_minor
    AND per_spin_max_bet_minor <= per_day_player_max_wager_minor
    AND per_spin_max_bet_minor <= campaign_budget_minor
    AND per_day_player_max_reward_minor <= campaign_budget_minor
    AND campaign_jackpot_cap_minor <= campaign_budget_minor
  )
);

CREATE UNIQUE INDEX operator_limits_one_active_per_scope
  ON operator_limits (scope_id)
  WHERE status = 'active';

CREATE INDEX operator_limits_scope_status
  ON operator_limits (scope_id, status);

CREATE TABLE admin_audit_events (
  id text PRIMARY KEY,
  action text NOT NULL,
  target_id text NOT NULL,
  actor text NOT NULL,
  reason text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX admin_audit_events_target_created_at
  ON admin_audit_events (target_id, created_at);

-- migrate:down

DROP INDEX IF EXISTS admin_audit_events_target_created_at;
DROP TABLE IF EXISTS admin_audit_events;
DROP INDEX IF EXISTS operator_limits_scope_status;
DROP INDEX IF EXISTS operator_limits_one_active_per_scope;
DROP TABLE IF EXISTS operator_limits;
DROP TYPE IF EXISTS operator_limit_status;
