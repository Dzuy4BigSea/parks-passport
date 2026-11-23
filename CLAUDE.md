# Parks Passport

Spec: see SPEC.md. Plan: see PLAN.md. A personal passport of St. Pete parks: GPS check-ins,
photos, ratings, badges, Park Pals. App key `parks-passport`, domain
`parkspassport.dzuynguyen.com`, container port 8080. Node 22 + Fastify, server-rendered
HTML, SQLite at `/data/app.db`.

## Commands (created in PLAN.md Milestone 0)
- Dev: `npm run dev` (http://localhost:8080; `MAIL_TRANSPORT=outbox`)
- Test (unit): `npm run test:unit` (`node --test`)
- Test (e2e/browser): `npm run test:e2e -- --trace off` (Playwright + axe)
- Lint: `npm run lint`
- All checks (what CI runs): `npm test`
- Seed parks: `npm run seed:scrape` (dev only; writes `seed/parks.csv`)

## Working rules
- Think before coding: state assumptions; ask when the spec is ambiguous instead of guessing.
- Simplicity first: minimum code that meets the acceptance criteria; no speculative features.
- Surgical changes: touch only what the task needs; mention unrelated issues instead of fixing them.
- Done means verified: a task is complete only when its checks in PLAN.md pass. Run them; don't assume.

## Project gotchas
- **Pushing to `main` deploys to production** (`.github/workflows/deploy.yml`). Work on a
  branch and open a PR. Merge only when Dzuy asks.
- Secrets live only in the server's `.env` and GitHub Actions secrets: never in the repo,
  a commit, a test or a chat. Every new variable goes in `.env.example` with a dummy value.
- Keep `/healthz`. The deploy checks it.
- Data lives in `/data` (Docker volume). Never write inside the code folder, because the
  deploy's `rsync --delete` wipes it. Seed files go in `seed/`, not `data/` (`data` is
  excluded from the rsync and the Docker build).
- Visit coordinates and EXIF must never reach another user. No PII in dataLayer/Umami events.
- Visibility returns 404, not 403, so it doesn't reveal that an account exists.
- Container limit is 512 MB on a shared box. Prefer small deps.
- Dzuy's machine has no Python and no `gh`. Tests run in CI (or in this cloud session).
- Files may have CRLF endings. Prefer the Edit tool over sed for replacements.

## Hosting on aster

`aster` is an SSH alias on Dzuy's Windows machine for a Hostinger VPS
(Ubuntu 24.04, 2 vCPU, 8 GB RAM, ~96 GB disk, about 75% full). Around 15
unrelated apps share it, so treat everything that isn't this app as
someone else's production.

### How traffic reaches an app

```
browser ─► :80/:443 ─► "nginx" container (shared front door, owns 80/443)
                          │  one server block per domain, TLS from /etc/letsencrypt
                          ▼
             Docker network "bigsea-internal"
                          ▼
             parks-passport container (no host port; reached by container name)
```

- The front door is the `nginx` container from `/opt/claude-sync/docker-compose.yml`
  (it shares that file with `mission-control`). Its config is the single file
  `/opt/claude-sync/nginx.conf`, mounted read-only as `default.conf`.
- Apps join the external network `bigsea-internal`. nginx proxies to
  `http://<container_name>:<port>`. **No host port is needed** and none should be
  published unless there's a real reason. Host ports already taken: 80, 443, 3000,
  3001, 3010, 3020, 8088, 8090, 8100, and 5432 (on localhost only).
- TLS: certbot on the host, **webroot** method. Every port-80 block serves
  `/.well-known/acme-challenge/` from `/etc/letsencrypt/webroot`. `certbot.timer`
  renews, and `/etc/letsencrypt/renewal-hooks/deploy/10-reload-nginx.sh` reloads
  the nginx container afterwards. Nothing per-app is needed for renewals.

### Where the app lives

- Code: `/opt/claude-sync/parks-passport/` on the server, owned by `wwdeploy`, which
  is the deploy user and is in the `docker` group.
- `.env` on the server sits next to the code. It's written by hand or by the
  workflow from a GitHub secret, and it's excluded from the rsync, so deploys
  never overwrite it.
- Persistent data goes in a **named Docker volume** (`parks-passport-data`), never inside
  the code folder: the deploy's `rsync --delete` would wipe it.

### Files this repo needs

**`docker-compose.aster.yml`**: the server's compose file. Keep a plain
`docker-compose.yml` for local dev if you like.

```yaml
# Deploy config for aster: joins the shared bigsea-internal network so the
# front nginx container reaches this app as http://parks-passport:8080.
#   docker compose -f docker-compose.aster.yml up -d --build
services:
  parks-passport:
    build: .
    image: parks-passport:latest
    container_name: parks-passport          # must be unique on the server
    restart: unless-stopped
    env_file: .env
    environment:
      PORT: 8080
    volumes:
      - parks-passport-data:/data
    expose:
      - "8080"
    mem_limit: 512m                # shared 8 GB box; raise only if needed
    networks:
      - bigsea-internal

volumes:
  parks-passport-data:

networks:
  bigsea-internal:
    external: true
```

**A `/healthz` route** that returns 200 when the app is up. The deploy checks it.

**`.env.example`**: every variable the app reads, with dummy values.

**`.dockerignore`**: at least `.git`, `node_modules`, `.env`, `data`.

**`.github/workflows/deploy.yml`**: deploys on every push to `main`.

```yaml
name: Deploy to aster
on:
  push:
    branches: [main]
  workflow_dispatch: {}
concurrency:
  group: deploy-parks-passport
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up SSH
        run: |
          mkdir -p ~/.ssh
          printf '%s' "${{ secrets.ASTER_SSH_KEY }}" | base64 -d > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          printf '%s\n' "${{ secrets.ASTER_KNOWN_HOSTS }}" > ~/.ssh/known_hosts
      - name: Sync code to server
        run: |
          rsync -az --delete \
            --exclude='.git' --exclude='node_modules' --exclude='dist' \
            --exclude='.env' --exclude='data' \
            -e "ssh -i ~/.ssh/deploy_key -o IdentitiesOnly=yes" \
            ./ "${{ secrets.ASTER_USER }}@${{ secrets.ASTER_HOST }}:/opt/claude-sync/parks-passport/"
      - name: Build & restart
        run: |
          ssh -i ~/.ssh/deploy_key -o IdentitiesOnly=yes \
            "${{ secrets.ASTER_USER }}@${{ secrets.ASTER_HOST }}" \
            'cd /opt/claude-sync/parks-passport && docker compose -f docker-compose.aster.yml up -d --build && docker image prune -f'
      - name: Verify health
        run: |
          for i in 1 2 3 4 5 6; do
            curl -fsS https://parkspassport.dzuynguyen.com/healthz && exit 0
            sleep 5
          done
          exit 1
```

### First-time setup (once per project)

Do these in order. Claude can do the server steps over `ssh aster` (as root),
but says what it's about to change and waits for Dzuy's go-ahead before
editing `nginx.conf` or issuing a certificate. Steps marked **(Dzuy)** need
an account only Dzuy has.

1. **Repo:** create the GitHub repo **(Dzuy)**. Add the files above. Make the
   app run locally first.
2. **DNS (Dzuy):** add an A record for `parkspassport.dzuynguyen.com` pointing at the server, using
   the same IP as the other apps. Check it with `nslookup parkspassport.dzuynguyen.com` before step 5.
3. **Server folder:**
   `ssh aster "mkdir -p /opt/claude-sync/parks-passport && chown wwdeploy:wwdeploy /opt/claude-sync/parks-passport"`.
   Write the production `.env` there (`chmod 600`).
4. **Deploy key:** make a new key just for this project. Don't reuse
   another app's key.
   - Generate it locally in a temp folder:
     `ssh-keygen -t ed25519 -N "" -C "parks-passport-ci" -f <tmp>/parks-passport_deploy`
   - Append the `.pub` line to `/home/wwdeploy/.ssh/authorized_keys` on aster.
   - **(Dzuy)** in GitHub → repo Settings → Secrets and variables → Actions, add:
     - `ASTER_SSH_KEY`: the private key, base64-encoded on one line
       (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("<tmp>\parks-passport_deploy")) | Set-Clipboard`)
     - `ASTER_KNOWN_HOSTS`: the output of `ssh-keyscan <server host>`
     - `ASTER_USER`: `wwdeploy`
     - `ASTER_HOST`: the server's hostname or IP
   - Delete the local private key once the secret is saved. Claude never prints
     the private key in chat.
5. **nginx, HTTP first.** The certificate doesn't exist yet, and nginx won't start
   with a missing cert file, so add only the port-80 block for now. Back up and test before reloading:
   ```bash
   ssh aster 'cp /opt/claude-sync/nginx.conf /opt/claude-sync/nginx.conf.bak-$(date +%Y%m%d-%H%M%S)'
   # append the block below between START/END markers, then:
   ssh aster 'docker exec nginx nginx -t && docker exec nginx nginx -s reload'
   ```
   ```nginx
   # === parks-passport (parkspassport.dzuynguyen.com) START ===
   server {
       listen 80;
       server_name parkspassport.dzuynguyen.com;
       location /.well-known/acme-challenge/ { root /etc/letsencrypt/webroot; try_files $uri =404; }
       location / { return 301 https://$host$request_uri; }
   }
   # === parks-passport (parkspassport.dzuynguyen.com) END ===
   ```
6. **Certificate:**
   `ssh aster "certbot certonly --webroot -w /etc/letsencrypt/webroot -d parkspassport.dzuynguyen.com"`
7. **nginx, HTTPS.** Add this inside the same markers, then `nginx -t` and reload again:
   ```nginx
   server {
       listen 443 ssl;
       server_name parkspassport.dzuynguyen.com;
       ssl_certificate     /etc/letsencrypt/live/parkspassport.dzuynguyen.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/parkspassport.dzuynguyen.com/privkey.pem;
       client_max_body_size 10m;
       location / {
           proxy_pass         http://parks-passport:8080;
           proxy_http_version 1.1;
           proxy_set_header   Host $host;
           proxy_set_header   X-Real-IP $remote_addr;
           proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header   X-Forwarded-Proto $scheme;
           proxy_set_header   Upgrade $http_upgrade;      # websockets / SSE
           proxy_set_header   Connection "upgrade";
       }
   }
   ```
   nginx resolves `parks-passport` when it reloads. If the container isn't running yet,
   `nginx -t` fails with "host not found", so do the first deploy (step 8) before
   this step, or reload once the container is up.
8. **First deploy:** push to `main`, or run the workflow by hand, and watch it in
   GitHub → Actions. Then `curl -I https://parkspassport.dzuynguyen.com/healthz`.

### Day to day

- **Deploy:** merge to `main`. The workflow syncs, rebuilds and health-checks.
- **Logs:** `ssh aster "docker logs --tail 100 parks-passport"`
- **Restart:** `ssh aster "cd /opt/claude-sync/parks-passport && docker compose -f docker-compose.aster.yml restart"`
- **Shell inside:** `ssh aster "docker exec -it parks-passport sh"`
- **Roll back:** revert the commit on `main`. The workflow redeploys the old code.
- **Backups:** if the app keeps data that matters, add a nightly dump to root's
  crontab, in the same style as the existing `0 2 * * *` and `15 3 * * *` entries.
  Write dumps to a folder outside the code tree, and keep a rolling 14 days.

### Never do these on aster

- Never touch another app's containers, volumes, networks or folders. Never
  run `docker compose down` in `/opt/claude-sync/`: that compose file runs the
  shared front door, and stopping it takes **every** site offline.
- Never run `docker system prune -a`, `docker volume prune` or anything with
  `--volumes`. Other apps' data lives in volumes. `docker image prune -f` is fine.
- Never reload nginx without `nginx -t` passing first. One bad block takes down
  every domain. Back up `nginx.conf` before each edit, and only change lines
  between this app's START/END markers.
- Never publish a host port that's already taken, and never bind a database to
  `0.0.0.0`. The firewall is off, so a published port is open to the internet.
- Never change sshd, the firewall, certbot's timer or hooks, or other users'
  `authorized_keys` lines.
- Watch the disk (`df -h /`). It's shared and about 75% full. Prune this app's
  old images, not everyone's.

## Dzuy's machine

- Windows 11. Claude Code's shells are PowerShell 5.1 and Git Bash. Use Unix
  syntax in Bash and PowerShell syntax in PowerShell.
- **No local Python and no `gh` CLI.** Run tests in CI, or in a throwaway
  container on aster, never against production data. Open PRs on github.com
  in the browser.
- Files may have CRLF line endings. Scripted find-and-replace (sed, node) can
  silently match nothing on them, so prefer the Edit tool, then re-check.
- Before pushing frontend changes, run the build and check its **exit code**,
  not its output text.
