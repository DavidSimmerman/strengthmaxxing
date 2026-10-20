# Deploying strengthmaxxing on Coolify

Two containers: **web** (SvelteKit dashboard + JSON API, port 3000, owns the
SQLite DB) and **agent** (Claude coach, port 8787, internal-only). The iOS /
watchOS app talks only to **web**.

`deploy/docker-compose.yml` wires both on a shared network so `web` reaches the
coach at `http://agent:8787`, and mounts a named volume (`smx-data`) for the
SQLite database.

---

## Option 1 — one Docker Compose deployment (recommended)

Deploy both services from the single compose file.

1. **New Resource → Docker Compose** in Coolify, pointed at this git repo.
2. Set **Base Directory** to the repo root and **Compose file** to
   `deploy/docker-compose.yml`. (The build contexts are `../web` and `../agent`,
   relative to the compose file, so they resolve to the repo's `web/` and
   `agent/`.)
3. **Environment variables** (Coolify → Environment): copy from
   [`../.env.example`](../.env.example) and fill in:
   - `API_TOKEN` — required in prod. Generate: `openssl rand -hex 32`. The
     iPhone and Watch send this.
   - `DASHBOARD_PASSWORD` — what you type to sign in to the dashboard in a
     browser. Blank = reuse `API_TOKEN`.
   - `DB_PATH` — leave as `/data/strengthmaxxing.db` (inside the volume).
   - `AGENT_URL` — leave as `http://agent:8787`.
   - `ANTHROPIC_API_KEY` — optional (see "Coach auth" below).
   - `AGENT_MODEL` — optional model override.
   Mark `API_TOKEN` and `ANTHROPIC_API_KEY` as **secrets**.
4. **Domain**: assign `https://strengthmaxxing.simmerman.tech` to the **web**
   service (container port 3000). Leave **agent** with no domain — it must stay
   internal. Don't put Cloudflare Access (or any login page) in front of `/api/*`:
   the Watch can't get past a browser login. The app's own password + token
   protect everything.
5. Deploy. First boot runs SQLite migrations automatically (web's
   `hooks.server.ts`).

## Option 2 — two separate Coolify apps

If you prefer independent lifecycles:

- **agent app**: Dockerfile deploy, Base Directory `agent/`. No public domain.
  Set `PORT=8787` and coach auth. Note its internal URL.
- **web app**: Dockerfile deploy, Base Directory `web/`. Public domain → port
  3000. Set `API_TOKEN`, `DB_PATH`, and `AGENT_URL` to the agent app's reachable
  URL. Both apps must share a Docker network (or the agent must be reachable at
  the `AGENT_URL` you set) for the coach proxy to work.

The compose file (Option 1) is simpler because Coolify puts both on one network
and gives you `http://agent:8787` for free.

---

## Persistent volume for the database

SQLite lives in a file, so it **must** sit on a persistent volume or every
redeploy wipes your history.

- Option 1 handles this: the named volume `smx-data` is mounted at `/data`, and
  `DB_PATH=/data/strengthmaxxing.db` writes there.
- For Option 2 (web as a plain Dockerfile app), add a **Persistent Storage**
  entry in Coolify: mount a volume at `/data`, and keep
  `DB_PATH=/data/strengthmaxxing.db`.

Back up by copying that file out of the volume (`.db`, plus `-wal`/`-shm` if
present) while the app is stopped, or via `sqlite3 <db> ".backup"`.

## Coach auth (agent → Claude)

The agent calls Claude two ways; pick one:

- **A) Personal Claude subscription** (via the `claude` CLI). Uncomment the
  volume mount in `docker-compose.yml`:
  ```yaml
  volumes:
    - /root/.claude:/root/.claude:ro
  ```
  Point the host path (left side) at wherever your logged-in `~/.claude` creds
  live on the Coolify server. The container-side path must stay `/root/.claude`
  — the agent container runs as root, so that's where the CLI looks. Leave
  `ANTHROPIC_API_KEY` unset.
- **B) API key**. Set `ANTHROPIC_API_KEY` (a secret) in the agent's environment;
  no mount needed. This is the simplest option for a headless server.

If neither is configured the coach endpoints (`/api/coach/*`) will fail with a
502 from the web app.

## Pointing the iOS / watch app at the deployment

In the app's settings:

- **Base URL** = your web domain, e.g. `https://smx.example.com` (the app hits
  `<base>/api/...`).
- **Bearer token** = the same value you set for `API_TOKEN`. The app sends it as
  `Authorization: Bearer <token>` on every `/api/*` request.

That's it — the watch posts sets to `/api/sessions/:id/sets`, finishes via
`/api/sessions/:id/finish`, and the app writes the workout to Apple Fitness /
HealthKit locally.

## Sanity check the compose file locally

```sh
docker compose -f deploy/docker-compose.yml config -q   # validates YAML/refs
```
