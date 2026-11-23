# Backups and restore

## What's backed up
`scripts/backup.sh` runs nightly on aster from root's crontab and writes to
`/root/backups/parks-passport/`, keeping 14 days:

- `app-YYYY-MM-DD.db.gz`: the whole SQLite database (accounts, visits, ratings, badges, pals,
  settings), copied with SQLite's online backup API and integrity-checked.
- `files-YYYY-MM-DD.tar.gz`: `uploads/` (photos and badge art) and `settings.key`, if the app
  generated one. That key decrypts the SendGrid key saved in Admin › Email; without it, re-enter the
  SendGrid key after a restore.

Umami's own database has a separate nightly `pg_dump` (see `docs/umami-setup-prompt.md`).

## Install (local Claude session with `ssh aster`)
Paste this into a Claude Code session on Dzuy's machine, after the PR with `scripts/backup.sh` is
merged and deployed:

> Set up nightly backups for Parks Passport on aster, following CLAUDE.md ("Never do these on
> aster"). Show me each change before making it.
> 1. Run it once by hand: `ssh aster "bash /opt/claude-sync/parks-passport/scripts/backup.sh"`.
>    Show the output and `ls -lh /root/backups/parks-passport/`. Stop if it fails.
> 2. Check it restores: copy the newest `app-*.db.gz` to `/tmp` on aster, `gunzip` it, and run
>    `docker run --rm -v /tmp:/b parks-passport:latest node -e "const D=require('better-sqlite3');const d=new D('/b/<file>.db',{readonly:true});console.log(d.pragma('integrity_check',{simple:true}), d.prepare('select count(*) n from parks').get())"`.
>    Expect `ok` and about 102 parks. Delete the temp copy afterwards.
> 3. Add to root's crontab, next to the existing `0 2 * * *` and `15 3 * * *` entries:
>    `40 2 * * * bash /opt/claude-sync/parks-passport/scripts/backup.sh >> /var/log/parks-passport-backup.log 2>&1`.
>    Show me `crontab -l` before and after.
> 4. Report the backup size and `df -h /`.

## Restore
1. Stop the app: `ssh aster "cd /opt/claude-sync/parks-passport && docker compose -f docker-compose.aster.yml stop parks-passport"`.
2. Copy the backup into the volume (it is mounted at `/data`), replacing `app.db` and removing any
   `app.db-wal` / `app.db-shm`:
   ```bash
   gunzip -c /root/backups/parks-passport/app-YYYY-MM-DD.db.gz > /tmp/app.db
   docker run --rm -v parks-passport_parks-passport-data:/data -v /tmp:/b alpine sh -c \
     'rm -f /data/app.db-wal /data/app.db-shm && cp /b/app.db /data/app.db && chown 1000:1000 /data/app.db'
   ```
   (Check the volume name with `docker volume ls | grep parks-passport`.)
3. Files, if needed: `docker run --rm -v parks-passport_parks-passport-data:/data -v /root/backups/parks-passport:/b alpine sh -c 'tar xzf /b/files-YYYY-MM-DD.tar.gz -C /data && chown -R 1000:1000 /data/uploads'`.
4. Start it: `… docker compose -f docker-compose.aster.yml up -d parks-passport`, then
   `curl -fsS https://parkspassport.dzuynguyen.com/healthz`.
