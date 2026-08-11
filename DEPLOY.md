# Deploying to Fly.io

This app is one persistent Node process (in-memory lobby rooms + live games, one
WebSocket layer) backed by a SQLite file — it needs a single long-running instance with
a persistent disk, not a serverless/auto-scaling setup. Fly.io fits that well: cheap
always-on VMs, native WebSocket support, and persistent volumes.

`Dockerfile` and `.dockerignore` in the repo root are already set up for this. What's
left is account/infra setup, which only you can do interactively (flyctl login opens a
browser).

## 1. Install flyctl and sign in

```bash
# macOS
brew install flyctl
# Windows (PowerShell)
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
# Linux
curl -L https://fly.io/install.sh | sh

fly auth login   # opens a browser; sign up if you don't have an account yet
```

## 2. Launch the app (generates fly.toml, doesn't deploy yet)

From the repo root:

```bash
fly launch --no-deploy
```

- It'll detect the `Dockerfile` and ask to confirm.
- Pick an app name (must be globally unique on Fly — `nba-stat-poker-yourname` or similar).
- Pick a region close to you/your players.
- **Say no** to any offer to add a Postgres or Redis database — this app only needs
  SQLite on a volume, not a managed database.
- This writes a `fly.toml` into the repo. Open it and check/adjust:
  - `internal_port = 5500` under `[http_service]` (matches the port `server/server.js`
    listens on by default).
  - Add (or confirm) an always-on setting so the app doesn't sleep between visits:
    ```toml
    [http_service]
      internal_port = 5500
      force_https = true
      auto_stop_machines = false
      auto_start_machines = true
      min_machines_running = 1
    ```

## 3. Create a persistent volume for the database

The SQLite file lives at `server/data/app.db` inside the container (see `server/db.js`)
— without a volume, it resets on every deploy/restart.

```bash
fly volumes create nba_poker_data --size 1 --region <same region you picked above>
```

Then add a mount pointing at that volume in `fly.toml`:

```toml
[mounts]
  source = "nba_poker_data"
  destination = "/app/server/data"
```

## 4. Set secrets

```bash
fly secrets set SESSION_SECRET="$(openssl rand -hex 32)"
```

Without this, the server auto-generates a random secret on every boot (it'll log a
warning) and everyone gets logged out on every restart/deploy — fine for local dev, not
for a real deployment.

Optional, only if you want the "Sign in with Google" button to appear:

```bash
fly secrets set GOOGLE_CLIENT_ID="your-google-oauth-client-id"
```

(This is a public client ID, not a real secret, but `fly secrets` is a convenient place
to keep it alongside everything else — a plain `[env]` entry in `fly.toml` works too.)

## 5. Deploy

```bash
fly deploy
```

flyctl builds the Docker image on Fly's remote builders (you don't need Docker
installed locally) and ships it. Once it finishes, `fly status` shows the app's URL —
something like `https://your-app-name.fly.dev`, with HTTPS handled automatically.

## Verifying it worked

- Visit the URL — you should land on the mode-select homepage (`index.html`).
- Sign up a test account, confirm login persists after a `fly deploy` (proves
  `SESSION_SECRET` is actually set and the volume is mounted correctly).
- Open the same account in two browser tabs/two devices and confirm a multiplayer room
  created in one is visible/joinable from the other — proves the WebSocket layer is
  reachable through Fly's proxy.

## Redeploying after future code changes

Just `fly deploy` again from the repo root — no other steps needed, the volume and
secrets persist across deploys.

## A note on migrating your existing local accounts

Your local `server/data/app.db` (with whatever test accounts you've already created)
isn't copied into the image (`.dockerignore` excludes `server/data` on purpose — a
deploy shouldn't ship your local dev DB). If you want those specific accounts to exist
on the deployed instance too, you'd need to manually copy the file onto the volume
(`fly sftp shell`, or `fly ssh console` + copy in some other way) — happy to walk
through that if you want it, but simplest is usually to just let people sign up fresh.
