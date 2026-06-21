-- migrate:up

CREATE TABLE game_config_math_reports (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES game_config_versions(id) ON DELETE RESTRICT,
  config_id text NOT NULL,
  config_version_id text NOT NULL,
  report_json jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT game_config_math_reports_unique_draft UNIQUE (draft_id)
);

CREATE INDEX game_config_math_reports_config_version_idx
  ON game_config_math_reports (config_version_id, created_at DESC);

CREATE TABLE game_config_simulation_runs (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES game_config_versions(id) ON DELETE RESTRICT,
  config_id text NOT NULL,
  config_version_id text NOT NULL,
  input_json jsonb NOT NULL,
  result_json jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX game_config_simulation_runs_draft_created_idx
  ON game_config_simulation_runs (draft_id, created_at, id);

CREATE INDEX game_config_simulation_runs_config_version_idx
  ON game_config_simulation_runs (config_version_id, created_at DESC);

CREATE TABLE game_config_audit_events (
  id text PRIMARY KEY,
  action text NOT NULL,
  target_id text NOT NULL REFERENCES game_config_versions(id) ON DELETE RESTRICT,
  actor text NOT NULL,
  reason text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  CONSTRAINT game_config_audit_events_action_check CHECK (action IN ('config.activate', 'config.rollback'))
);

CREATE INDEX game_config_audit_events_created_idx
  ON game_config_audit_events (created_at, id);

CREATE INDEX game_config_versions_status_created_idx
  ON game_config_versions (status, created_at, id);

CREATE INDEX game_config_versions_config_version_number_idx
  ON game_config_versions (config_id, version_number);

-- migrate:down

DROP INDEX IF EXISTS game_config_versions_config_version_number_idx;
DROP INDEX IF EXISTS game_config_versions_status_created_idx;
DROP INDEX IF EXISTS game_config_audit_events_created_idx;
DROP TABLE IF EXISTS game_config_audit_events;
DROP INDEX IF EXISTS game_config_simulation_runs_config_version_idx;
DROP INDEX IF EXISTS game_config_simulation_runs_draft_created_idx;
DROP TABLE IF EXISTS game_config_simulation_runs;
DROP INDEX IF EXISTS game_config_math_reports_config_version_idx;
DROP TABLE IF EXISTS game_config_math_reports;