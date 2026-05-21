# AI World

A tiny 3D world inhabited by autonomous voxel villagers. Admins paint the map; agents make decisions each tick using GPT-5.4-mini (with a rule-based fallback). State persists in PostgreSQL. Designed to deploy on Railway.

## Stack

- **Server**: Node.js 20, Fastify, `@fastify/websocket`, `@fastify/jwt`
- **DB**: PostgreSQL (`pg`)
- **AI**: OpenAI SDK, `gpt-5.4-mini`
- **Client**: Three.js (ESM via importmap), vanilla JS, voxel humanoid built from boxes

## Local dev

1. Postgres running locally (or use Railway shadow URL).
2. `cp .env.example .env` and fill in:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `OPENAI_API_KEY` (optional — without it, rule-based decisions only)
3. Install + migrate + start:
   ```bash
   npm install
   npm run migrate
   npm start
   ```
4. Open http://localhost:3000.

A default admin user is created on first migration. Defaults:

- username: `admin`
- password: `admin123` (override via `ADMIN_PASSWORD`)

## Deploy to Railway

1. Push this repo to GitHub.
2. On Railway: **New Project → Deploy from GitHub** → pick this repo.
3. Add a **PostgreSQL** plugin to the project. Railway will auto-inject `DATABASE_URL`.
4. Add env vars:
   - `JWT_SECRET` (long random string)
   - `OPENAI_API_KEY`
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD`
5. Deploy. The Dockerfile runs migrations before launching the server.

## Architecture

```
client/
  index.html, style.css
  app.js                — Three.js scene, orbit camera, agent sprites, WS handler
  world-render.js       — Voxel terrain + objects
  voxel-character.js    — Humanoid agent mesh + walk-cycle animation
server/
  index.js              — Fastify entry, WS broadcast
  auth.js               — JWT decorators
  db/index.js           — pg pool
  db/migrate.js         — apply SQL migrations, seed admin + default world
  routes/auth.js        — register/login/me
  routes/world.js       — read world (public), edit cells (admin)
  routes/agents.js      — CRUD agents (admin), read (public)
  sim/tick.js           — main loop, runs every TICK_INTERVAL_MS
  sim/decision.js       — perception + GPT-5.4-mini decision + rule fallback
  sim/actions.js        — move/rest/say/idle handlers, passability rules
db/migrations/
  001_init.sql
```

## Data model

- `users(id, username, password_hash, role)` — `admin` can edit map and spawn agents
- `worlds(id, name, grid_size, owner_id)`
- `cells(world_id, x, z, terrain, kind, floors, terrain_floors, extras, appearance)` — sparse
- `agents(id, world_id, name, x, z, facing, appearance, personality, attributes, memory, goals, last_action, last_thought)`
- `agent_events(id, agent_id, world_id, tick, event_type, payload)` — replay/audit log
- `agent_relations(agent_a, agent_b, affinity, last_interaction_at)`

### Personality dimensions (0..100)

`curiosity`, `bravery`, `sociability`, `laziness`, `kindness`

### Attributes (0..100)

`hp`, `energy`, `hunger`, `social`, `mood`

## How decisions work

Each tick the simulator:

1. Loads every agent + world cells.
2. Builds a small perception bundle (nearby tiles + agents within 4 cells).
3. Calls `decide(agent, ctx)`:
   - If `OPENAI_API_KEY` is set AND (neighbors are near OR a curiosity roll passes), calls `gpt-5.4-mini` with the agent's state + perception and parses a JSON action.
   - Otherwise (or if the LLM call fails), uses a rule-based policy keyed on personality.
4. Applies the action (move/rest/say/idle), updates DB, broadcasts via WebSocket to all clients on `/live/:worldId`.

## Controls

- Drag = orbit camera (right-click or alt-drag if you're an admin painting)
- Scroll = zoom
- Click (as admin) = paint tile with selected terrain + object
- Shift+click = erase to grass
- Hover an agent → inspector panel on the right

## Env reference

| Var                                 | Purpose                                        |
| ----------------------------------- | ---------------------------------------------- |
| `DATABASE_URL`                      | Postgres connection string                     |
| `JWT_SECRET`                        | Sign JWTs                                      |
| `OPENAI_API_KEY`                    | Enables LLM decisions                          |
| `OPENAI_MODEL`                      | Defaults to `gpt-5.4-mini`                     |
| `TICK_INTERVAL_MS`                  | Sim cadence, default 1500                      |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Seed admin                                     |
| `DISABLE_SIM`                       | Set `1` to launch server without the tick loop |
| `PORT`                              | Bind port (Railway sets this)                  |
