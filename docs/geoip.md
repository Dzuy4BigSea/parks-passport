# Nearest-city suggestion (GeoIP)

The home page can say "Looks like you're near Westminster" to a first-time visitor (SPEC Flow 13).
It looks the visitor's IP address up in a MaxMind **GeoLite2-City** database file on the server.
The IP never leaves the server and is never stored or logged. Without the file the feature is off
and nothing else changes.

## One-time setup (Dzuy)

1. Create a free MaxMind account at maxmind.com (GeoLite2) and generate a license key.
2. On aster, download the database into the app's data volume, for example:

   ```bash
   ssh aster
   docker exec -it parks-passport sh -c 'mkdir -p /data/geoip'
   # On the host, fetch with your license key (never commit it or paste it in chat):
   curl -fsSL -o /tmp/GeoLite2-City.tar.gz \
     "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=$MAXMIND_LICENSE_KEY&suffix=tar.gz"
   tar -xzf /tmp/GeoLite2-City.tar.gz -C /tmp
   docker cp /tmp/GeoLite2-City_*/GeoLite2-City.mmdb parks-passport:/data/geoip/GeoLite2-City.mmdb
   ```

3. Add `GEOIP_DB=/data/geoip/GeoLite2-City.mmdb` to the server's `.env`, then restart the app.
4. MaxMind publishes updates regularly and its license asks you to keep the file current. A small
   root cron job that repeats step 2 and restarts the container is enough.

## Notes

- The file is about 60 MB and is read into memory once at startup. Re-run
  `npm run check:memory` against a copy if you change the container's memory limit.
- Read MaxMind's current GeoLite2 EULA when you sign up (it covers attribution and how often
  the file must be refreshed). We only use the location to pick the nearest city.
