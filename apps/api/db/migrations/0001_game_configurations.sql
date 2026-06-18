-- migrate:up

CREATE TYPE game_config_status AS ENUM ('draft', 'active', 'retired');

CREATE TABLE game_config_versions (
  id text PRIMARY KEY,
  config_id text NOT NULL,
  version_id text NOT NULL,
  version_number integer,
  status game_config_status NOT NULL,
  config_json jsonb NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  activated_by text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  activated_at timestamptz,
  CONSTRAINT game_config_versions_unique_version UNIQUE (version_id),
  CONSTRAINT game_config_versions_unique_config_number UNIQUE (config_id, version_number),
  CONSTRAINT game_config_versions_active_requires_version CHECK (
    status <> 'active'
    OR (version_number IS NOT NULL AND activated_by IS NOT NULL AND activated_at IS NOT NULL)
  ),
  CONSTRAINT game_config_versions_draft_without_activation CHECK (
    status <> 'draft'
    OR (version_number IS NULL AND activated_by IS NULL AND activated_at IS NULL)
  )
);

CREATE UNIQUE INDEX game_config_versions_one_active
  ON game_config_versions ((status))
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION enforce_game_config_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'active' AND NEW.status NOT IN ('active', 'retired') THEN
      RAISE EXCEPTION 'active game configurations may only remain active or become retired';
    END IF;

    IF OLD.status = 'retired' AND NEW.status NOT IN ('retired', 'active') THEN
      RAISE EXCEPTION 'retired game configurations may only remain retired or become active during rollback';
    END IF;

    IF OLD.status = 'draft' AND NEW.status = 'retired' THEN
      RAISE EXCEPTION 'draft game configurations must activate before they can retire';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER game_config_versions_status_transition
  BEFORE UPDATE OF status ON game_config_versions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_game_config_status_transition();

-- migrate:down

DROP TRIGGER IF EXISTS game_config_versions_status_transition ON game_config_versions;
DROP FUNCTION IF EXISTS enforce_game_config_status_transition();
DROP INDEX IF EXISTS game_config_versions_one_active;
DROP TABLE IF EXISTS game_config_versions;
DROP TYPE IF EXISTS game_config_status;
