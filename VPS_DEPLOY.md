# Deploying to a Hostinger VPS

This project used to be deployed on Fly.io (the old `fly.toml`/`DEPLOY.md` have been
removed now that it isn't). It's one persistent Node process (Express + a `ws`
WebSocket layer, no framework like Colyseus) backed by a SQLite file at
`server/data/app.db`. It needs a single long-running instance, not serverless.

**Important, and easy to miss:** a Hostinger VPS commonly comes pre-provisioned with its
own management stack — `hermes-agent` (Hostinger's own agent container) and **Traefik**,
both running as Docker containers, with Traefik already bound to ports 80/443 and
terminating HTTPS via Let's Encrypt. If that's the case on your VPS, **do not** install
Nginx/certbot and try to bind port 80 yourself — it'll conflict. Check first:

```bash
ss -tlnp | grep :80
```

If that shows `traefik`, follow this guide as-is. If port 80 is free (a plain OS image
with nothing pre-installed), see the "Plain VPS, no Traefik" variant at the bottom
instead.

## 1. Confirm your domain

If Traefik is already running, Hostinger likely gave this VPS a free working hostname
like `<something>.hstgr.cloud` — check Traefik's own startup flags for a giveaway
(`ps aux | grep traefik`, look for `--certificatesresolvers.letsencrypt.acme.email`,
which is usually `postmaster@<that hostname>`), then test it:

```bash
curl -I http://<your-vps>.hstgr.cloud
```

A `308` redirect to `https://` confirms it already resolves here, no DNS setup needed.
Want a real domain instead? Add an A record in hPanel pointing at this VPS's IP
(`curl -4 ifconfig.me` to get it), then use that domain everywhere below instead.

## 2. Set up Node and get the code

```bash
apt update && apt install -y git
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
git clone <your-repo-url> ~/NBAStatPoker
cd ~/NBAStatPoker
```

(Node itself isn't strictly required on the host once you're running the app in Docker —
only `git` and `docker` are — but it's harmless to have and useful for quick local
debugging.)

## 3. Configure secrets

```bash
cd server
cp .env.example .env
openssl rand -hex 32   # copy this output
nano .env
```

Set:
```
SESSION_SECRET=<paste the random string here>
GOOGLE_CLIENT_ID=<optional — only if you want "Sign in with Google" to appear>
```

Without `SESSION_SECRET`, the server auto-generates a random one at boot and everyone
gets logged out on every restart. If you use `GOOGLE_CLIENT_ID`, add this VPS's domain
as an authorized origin for that OAuth Client ID in the Google Cloud Console.

`cd ..` back to the repo root before continuing.

## 4. Build and run the container

This project's existing `Dockerfile` (originally written for Fly.io) works unchanged —
it already runs as a non-root user and creates `/app/server/data` for the SQLite file.

```bash
docker build -t statpoker .
docker volume create statpoker-data
```

A **named volume** (not a raw host directory) is used deliberately: the Dockerfile's
`/app/server/data` is owned by a non-root `appuser`, and Docker initializes a named
volume from the image's existing directory/ownership on first run, so permissions just
work with no manual `chown`.

```bash
docker run -d \
  --name statpoker \
  --restart unless-stopped \
  --env-file server/.env \
  -v statpoker-data:/app/server/data \
  -l traefik.enable=true \
  -l "traefik.http.routers.statpoker.rule=Host(\`<your-domain>\`)" \
  -l traefik.http.routers.statpoker.entrypoints=websecure \
  -l traefik.http.routers.statpoker.tls.certresolver=letsencrypt \
  -l traefik.http.services.statpoker.loadbalancer.server.port=5500 \
  statpoker
```

Replace `<your-domain>` with the hostname from step 1. No `-p`/port-publishing flag is
needed — Traefik's Docker provider reaches the container directly over Docker's network
(it runs in host network mode, so it can route straight to any container's internal IP),
it just needs the label telling it which internal port (5500) to use. The client already
derives `wss://` from `location.protocol` at runtime and uses relative `/api/...` calls
throughout, so no client code changes are needed regardless of domain.

## 5. Verify

```bash
docker ps                          # statpoker should show "Up", no port mapping needed
docker logs statpoker --tail 20    # look for the startup line, no SESSION_SECRET warning
curl -I https://<your-domain>      # expect HTTP/2 200
```

Then in a real browser: visit the site, sign up a test account, and confirm a
multiplayer room created in one tab is joinable from another (proves the WebSocket path
through Traefik works).

## Updating after future code changes

```bash
cd ~/NBAStatPoker
git pull
docker build -t statpoker .
docker stop statpoker && docker rm statpoker
# re-run the same `docker run` command from step 4 — the named volume persists
# automatically across this, since it's not part of the container being removed
```

## A known limitation worth knowing about

The server logs `Warning: connect.session() MemoryStore is not designed for a
production environment` on boot. Sessions live in the Node process's memory: a container
restart/redeploy logs everyone out, and it isn't built to scale past one process. Fine
for a personal/low-traffic deployment; swapping in a persistent session store (e.g.
`connect-sqlite3`, backed by the same DB) is a reasonable future improvement but is a
separate change from deployment itself.

## Backing up the database

The DB runs in WAL mode, so a live copy of just `app.db` can be inconsistent. From the
host:

```bash
docker run --rm -v statpoker-data:/data -v "$PWD":/backup alpine \
  sh -c "cd /data && tar czf /backup/statpoker-data-backup.tar.gz ."
```

This snapshots the whole volume (all of `app.db`/`app.db-wal`/`app.db-shm` together)
without needing to stop the container first.

---

## Plain VPS, no Traefik

If `ss -tlnp | grep :80` came back empty (a bare OS image, no pre-installed reverse
proxy), use this instead of Docker/Traefik — plain `pm2` + Nginx + Certbot:

```bash
apt update && apt install -y nginx git certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
npm i -g pm2

git clone <your-repo-url> && cd NBAStatPoker/server
npm ci --omit=dev
cp .env.example .env   # fill in SESSION_SECRET, GOOGLE_CLIENT_ID as in step 3 above

pm2 start server.js --name statpoker
pm2 save && pm2 startup   # run the command it prints, if any
```

Nginx reverse proxy (`/etc/nginx/sites-available/statpoker`, then symlink into
`sites-enabled`):

```nginx
server {
  server_name your-domain.com;
  location / {
    proxy_pass http://127.0.0.1:5500;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

```bash
nginx -t && systemctl reload nginx
certbot --nginx -d your-domain.com
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

Same persistence caveat applies: never let a redeploy strategy delete `server/data/` —
it's gitignored and holds the live database.
