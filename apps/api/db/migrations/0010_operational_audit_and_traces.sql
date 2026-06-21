-- migrate:up

ALTER TABLE admin_audit_events
  ADD COLUMN role text NOT NULL DEFAULT 'unknown',
  ADD COLUMN resource_type text NOT NULL DEFAULT 'unknown',
  ADD COLUMN resource_id text NOT NULL DEFAULT 'unknown',
  ADD COLUMN request_id text,
  ADD COLUMN source text NOT NULL DEFAULT 'admin-api',
  ADD COLUMN outcome text NOT NULL DEFAULT 'succeeded',
  ADD COLUMN before_json jsonb,
  ADD COLUMN after_json jsonb;

UPDATE admin_audit_events
SET resource_id = target_id
WHERE resource_id = 'unknown';

CREATE INDEX admin_audit_events_actor_action_created_at
  ON admin_audit_events (actor, action, created_at DESC);

CREATE INDEX admin_audit_events_resource_created_at
  ON admin_audit_events (resource_type, resource_id, created_at DESC);

CREATE INDEX admin_audit_events_request_id_idx
  ON admin_audit_events (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX admin_audit_events_source_created_at
  ON admin_audit_events (source, created_at DESC);

CREATE TABLE request_traces (
  id text PRIMARY KEY,
  request_id text NOT NULL,
  correlation_id text,
  method text NOT NULL,
  path text NOT NULL,
  status_code integer NOT NULL,
  latency_ms integer NOT NULL,
  outcome text NOT NULL,
  error_code text,
  player_id text,
  session_id text,
  spin_id text,
  admin_actor text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT request_traces_status_code_range CHECK (status_code >= 100 AND status_code <= 599),
  CONSTRAINT request_traces_latency_non_negative CHECK (latency_ms >= 0),
  CONSTRAINT request_traces_outcome_valid CHECK (outcome IN ('succeeded', 'failed'))
);

CREATE INDEX request_traces_request_id_idx ON request_traces (request_id);
CREATE INDEX request_traces_path_occurred_idx ON request_traces (path, occurred_at DESC);
CREATE INDEX request_traces_outcome_occurred_idx ON request_traces (outcome, occurred_at DESC);
CREATE INDEX request_traces_status_occurred_idx ON request_traces (status_code, occurred_at DESC);
CREATE INDEX request_traces_player_occurred_idx ON request_traces (player_id, occurred_at DESC) WHERE player_id IS NOT NULL;
CREATE INDEX request_traces_session_occurred_idx ON request_traces (session_id, occurred_at DESC) WHERE session_id IS NOT NULL;
CREATE INDEX request_traces_spin_occurred_idx ON request_traces (spin_id, occurred_at DESC) WHERE spin_id IS NOT NULL;
CREATE INDEX request_traces_admin_actor_occurred_idx ON request_traces (admin_actor, occurred_at DESC) WHERE admin_actor IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS request_traces_admin_actor_occurred_idx;
DROP INDEX IF EXISTS request_traces_spin_occurred_idx;
DROP INDEX IF EXISTS request_traces_session_occurred_idx;
DROP INDEX IF EXISTS request_traces_player_occurred_idx;
DROP INDEX IF EXISTS request_traces_status_occurred_idx;
DROP INDEX IF EXISTS request_traces_outcome_occurred_idx;
DROP INDEX IF EXISTS request_traces_path_occurred_idx;
DROP INDEX IF EXISTS request_traces_request_id_idx;
DROP TABLE IF EXISTS request_traces;
DROP INDEX IF EXISTS admin_audit_events_source_created_at;
DROP INDEX IF EXISTS admin_audit_events_request_id_idx;
DROP INDEX IF EXISTS admin_audit_events_resource_created_at;
DROP INDEX IF EXISTS admin_audit_events_actor_action_created_at;
ALTER TABLE admin_audit_events
  DROP COLUMN IF EXISTS after_json,
  DROP COLUMN IF EXISTS before_json,
  DROP COLUMN IF EXISTS outcome,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS request_id,
  DROP COLUMN IF EXISTS resource_id,
  DROP COLUMN IF EXISTS resource_type,
  DROP COLUMN IF EXISTS role;
