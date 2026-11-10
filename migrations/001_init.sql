-- 001_init.sql : core schema for the Mock API Generator (Neon Postgres)

CREATE TABLE IF NOT EXISTS projects (
  id              text PRIMARY KEY,                 -- public id used in /api/v1/<id>/...
  name            text NOT NULL,
  owner_hash      text NOT NULL,                    -- sha256 of the anonymous management token
  email           text,                             -- optional, for later account upgrade (never required)
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb, -- project-wide simulation defaults
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_active_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_owner_idx  ON projects (owner_hash);
CREATE INDEX IF NOT EXISTS projects_active_idx ON projects (last_active_at);

CREATE TABLE IF NOT EXISTS resources (
  id          text PRIMARY KEY,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,                        -- URL segment, e.g. "users"
  schema      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ordered field definitions
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- per-resource simulation overrides
  next_id     integer NOT NULL DEFAULT 1,           -- auto-increment counter for record ids
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS records (
  project_id  text    NOT NULL,
  resource_id text    NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  id          integer NOT NULL,
  data        jsonb   NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, resource_id, id)         -- fast list / pagination / lookup
);
CREATE INDEX IF NOT EXISTS records_data_gin ON records USING GIN (data jsonb_path_ops);

CREATE TABLE IF NOT EXISTS request_logs (
  id          bigserial PRIMARY KEY,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource    text,
  method      text NOT NULL,
  path        text NOT NULL,
  status      integer NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  simulated   boolean NOT NULL DEFAULT false,
  ip_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_logs_project_idx ON request_logs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS request_logs_created_idx ON request_logs (created_at);

-- Fixed-window counters used for per-IP and per-project rate limits / daily quotas.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key          text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limit_window_idx ON rate_limit_counters (window_start);

-- Cache for LLM generated domain-specific values (saves cost + latency).
CREATE TABLE IF NOT EXISTS ai_cache (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
