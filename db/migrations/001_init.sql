-- AI World schema

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS worlds (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  grid_size   INTEGER NOT NULL DEFAULT 16,
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sparse cell storage. Default cell = grass with no object.
CREATE TABLE IF NOT EXISTS cells (
  world_id      INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  x             INTEGER NOT NULL,
  z             INTEGER NOT NULL,
  terrain       TEXT NOT NULL DEFAULT 'grass',
  kind          TEXT,
  floors        INTEGER NOT NULL DEFAULT 1,
  terrain_floors INTEGER NOT NULL DEFAULT 1,
  extras        JSONB,
  appearance    JSONB,
  PRIMARY KEY (world_id, x, z)
);

CREATE INDEX IF NOT EXISTS idx_cells_world ON cells(world_id);

CREATE TABLE IF NOT EXISTS agents (
  id           SERIAL PRIMARY KEY,
  world_id     INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  x            INTEGER NOT NULL DEFAULT 0,
  z            INTEGER NOT NULL DEFAULT 0,
  facing       INTEGER NOT NULL DEFAULT 0,           -- 0=N 1=E 2=S 3=W
  appearance   JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {bodyColor, hairColor, shirtColor, pantsColor}
  personality  JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {curiosity, bravery, sociability, laziness, kindness}
  attributes   JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {hp, energy, hunger, social, mood}
  memory       JSONB NOT NULL DEFAULT '[]'::jsonb,    -- recent observations
  goals        JSONB NOT NULL DEFAULT '[]'::jsonb,    -- goal stack
  last_action  TEXT,
  last_thought TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_world ON agents(world_id);

CREATE TABLE IF NOT EXISTS agent_events (
  id         BIGSERIAL PRIMARY KEY,
  agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  world_id   INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  tick       BIGINT NOT NULL,
  event_type TEXT NOT NULL,                          -- move|say|act|think|interact
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_world_tick ON agent_events(world_id, tick DESC);
CREATE INDEX IF NOT EXISTS idx_events_agent ON agent_events(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_relations (
  agent_a            INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_b            INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  affinity           INTEGER NOT NULL DEFAULT 0,    -- -100..100
  last_interaction_at TIMESTAMPTZ,
  PRIMARY KEY (agent_a, agent_b),
  CHECK (agent_a < agent_b)
);
