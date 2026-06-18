-- migrate:up

CREATE TYPE budget_protection_action_type AS ENUM ('disablePaidSpins', 'lowerMaxBet', 'pauseCampaign', 'requireHostApproval');
CREATE TYPE budget_protection_status AS ENUM ('active', 'reverted');

CREATE TABLE budget_protection_actions (
  id text PRIMARY KEY,
  scope_id text NOT NULL,
  action_type budget_protection_action_type NOT NULL,
  status budget_protection_status NOT NULL,
  parameters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  metric_state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL,
  reverted_by text,
  reverted_reason text,
  reverted_at timestamptz
);

CREATE INDEX budget_protection_actions_active_lookup
  ON budget_protection_actions (scope_id, status);

CREATE INDEX budget_protection_actions_type_lookup
  ON budget_protection_actions (scope_id, action_type, status);

CREATE TABLE budget_protection_audit_events (
  id text PRIMARY KEY,
  action text NOT NULL,
  target_id text NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX budget_protection_audit_target_created_at
  ON budget_protection_audit_events (target_id, created_at);

-- migrate:down

DROP INDEX IF EXISTS budget_protection_audit_target_created_at;
DROP TABLE IF EXISTS budget_protection_audit_events;
DROP INDEX IF EXISTS budget_protection_actions_type_lookup;
DROP INDEX IF EXISTS budget_protection_actions_active_lookup;
DROP TABLE IF EXISTS budget_protection_actions;
DROP TYPE IF EXISTS budget_protection_status;
DROP TYPE IF EXISTS budget_protection_action_type;
