# Umami setup on aster: prompt for a local Claude Code session

Paste everything below the line into a Claude Code session on Dzuy's machine (it has `ssh aster`).
Do it **after** the PR that adds the Umami services to `docker-compose.aster.yml` is merged to `main`
and deployed.

---

Set up Umami (cookieless analytics) for the Parks Passport app on aster. Follow `CLAUDE.md` in the
parks-passport repo, especially "Never do these on aster". Before each change on the server, say what
you're about to change and wait for my go-ahead before editing `nginx.conf`.

Context:
- The app is at `/opt/claude-sync/parks-passport/` (owned by `wwdeploy`), container `parks-passport`,
  on the shared Docker network `bigsea-internal`. Its `.env` is next to the code (mode 600).
- `docker-compose.aster.yml` already defines two services in the `analytics` compose profile:
  `parks-passport-umami` (Umami, port 3000, on `bigsea-internal` + a private network) and
  `parks-passport-umami-db` (Postgres 16, private network only, volume `parks-passport-umami-db`).
  Neither publishes a host port. They start only when the profile is enabled.
- The app loads the tracker from `https://parkspassport.dzuynguyen.com/stats/script.js` and sends
  events to `https://parkspassport.dzuynguyen.com/stats/api/send`, so nginx must serve exactly those
  two paths from Umami. Do not expose the Umami dashboard or the rest of its API on the public site.

Steps:
1. **Check room.** `ssh aster "df -h / && free -m"`. Umami + Postgres need about 512 MB RAM total and
   ~1 GB disk to start. Stop and tell me if the disk is above 85% or free memory is under 1 GB.
2. **Pick the Umami image.** Find the current stable Umami release that supports PostgreSQL
   (https://github.com/umami-software/umami/releases). Use its pinned GHCR tag, not `latest`.
3. **Add to `/opt/claude-sync/parks-passport/.env`** (keep mode 600, don't print secrets in chat):
   ```
   COMPOSE_PROFILES=analytics
   UMAMI_IMAGE=ghcr.io/umami-software/umami:<pinned tag>
   UMAMI_DB_PASSWORD=<generate: openssl rand -hex 24>
   UMAMI_APP_SECRET=<generate: openssl rand -hex 32>
   ```
   Generate the secrets on the server, e.g. `ssh aster "openssl rand -hex 24"`, and write them
   straight into the file; never echo them back.
4. **Start the containers:**
   `ssh aster "cd /opt/claude-sync/parks-passport && docker compose -f docker-compose.aster.yml up -d"`.
   Then `docker ps --filter name=parks-passport` and
   `docker logs --tail 50 parks-passport-umami`. Wait until the logs show Umami listening and the
   database migrations done. Confirm with
   `docker exec parks-passport node -e "fetch('http://parks-passport-umami:3000/api/heartbeat').then(r => console.log(r.status))"`
   (expect 200).
5. **nginx (shared front door), with my go-ahead first.** Back up `/opt/claude-sync/nginx.conf`
   (`cp … nginx.conf.bak-$(date +%Y%m%d-%H%M%S)`). Inside the parks-passport START/END markers, in the
   `listen 443 ssl` server block, add these two locations above `location /`:
   ```nginx
       # Umami tracker + collect endpoint only (first-party). Resolved per request so a stopped
       # Umami container can't break nginx -t for every site.
       location = /stats/script.js {
           resolver 127.0.0.11 valid=30s;
           set $umami http://parks-passport-umami:3000;
           proxy_pass $umami/script.js;
           proxy_set_header Host $host;
       }
       location = /stats/api/send {
           resolver 127.0.0.11 valid=30s;
           set $umami http://parks-passport-umami:3000;
           proxy_pass $umami/api/send;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header User-Agent $http_user_agent;
       }
   ```
   Then `docker exec nginx nginx -t` and, only if it passes, `docker exec nginx nginx -s reload`.
   Check: `curl -sI https://parkspassport.dzuynguyen.com/stats/script.js` is 200 with a JavaScript
   content type, and `curl -s -o /dev/null -w '%{http_code}' https://parkspassport.dzuynguyen.com/stats/`
   is NOT the Umami dashboard (it should be the app's 404).
6. **Dashboard access (no public exposure).** Find the container's IP:
   `ssh aster "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' parks-passport-umami"`
   and give me the SSH tunnel command, e.g. `ssh -N -L 3333:<that IP>:3000 aster`, so I can open
   http://localhost:3333. (If I later want a public dashboard on its own subdomain, that's a separate
   DNS + certificate + server block job.)
7. **First login.** Tell me to open the tunnel and sign in with Umami's default `admin` / `umami`, then
   change that password immediately (Settings > Profile). Then add a website: name "Parks Passport",
   domain `parkspassport.dzuynguyen.com`. Ask me to paste the Website ID (a UUID; not secret).
8. **Turn it on in the app.** Add to the app's `.env`:
   ```
   UMAMI_WEBSITE_ID=<the UUID>
   UMAMI_SCRIPT_URL=/stats/script.js
   UMAMI_HOST_URL=https://parkspassport.dzuynguyen.com/stats
   ```
   Restart only the app: `ssh aster "cd /opt/claude-sync/parks-passport && docker compose -f docker-compose.aster.yml up -d parks-passport"`.
9. **Verify.** Load https://parkspassport.dzuynguyen.com/parks in a browser. The page source has
   `data-website-id="<the UUID>"`, the Network tab shows a 2xx POST to `/stats/api/send`, and the
   Umami dashboard's Realtime view shows the visit. No cookies are set by Umami.
10. **Backups.** Add a nightly `pg_dump` of the Umami database to root's crontab in the same style as
    the existing `0 2 * * *` and `15 3 * * *` entries, writing to a folder outside the code tree and
    keeping 14 days, e.g.
    `docker exec parks-passport-umami-db pg_dump -U umami umami | gzip > /root/backups/parks-passport-umami/umami-$(date +\%F).sql.gz`
    plus a `find … -mtime +14 -delete`. Show me the crontab line before adding it.

Report at the end: what's running (`docker ps` lines), memory used by the two containers
(`docker stats --no-stream`), the nginx change, and anything you couldn't do.
