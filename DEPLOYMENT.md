# VPS deployment and HTTPS

## Current Pixelware VPS setup

The migration completed on 12 October 2026. A separate Caddy stack at `/var/www/reverse-proxy` owns public ports 80/443 and manages HTTPS automatically. The portfolio at `/var/www/oo-portfolio` and this application at `/var/www/cpp-systems-concepts` keep separate Compose stacks and use the external Docker network `pixelware-proxy`.

The public routes are:

- `https://pixelware.nl` -> `portfolio-web:8080`
- `https://www.pixelware.nl` -> redirects to `https://pixelware.nl`
- `https://systems.pixelware.nl` -> `systems-concepts-web:80`
- `https://www.systems.pixelware.nl` -> redirects to `https://systems.pixelware.nl`

On the VPS, this project's `.env` contains:

```dotenv
COMPOSE_FILE=compose.vps.yaml
COMPOSE_PROJECT_NAME=systems-concepts
PROXY_NETWORK=pixelware-proxy
TRUSTED_PROXY=reverse-proxy-caddy-1
```

The same settings are supplied in `.env.vps.example`. Use that file as `.env` on the VPS. Local Docker startup uses the root `compose.yaml` and serves `http://localhost:8080`.

The current shared proxy [Compose file](deploy/reverse-proxy/compose.yaml) and [Caddyfile](deploy/reverse-proxy/Caddyfile) are also saved in this repository, including both `www` redirects. The proxy runs independently from the app. Systems Concepts uses the same bundled Pixelware SVG favicon as the portfolio.

To update this app:

The experimental C++ Lab also adds a compile-only `cpp-compiler` service on a
private internal Docker network. The web container exposes its bounded API
through `/api/cpp/`; it compiles to WebAssembly, which executes in the visitor's
browser. See [the C++ Lab notes](CPP-LAB.md) for its execution limits. Updating with
the new Compose file will build and start the compiler along with the web app.

```sh
cd /var/www/cpp-systems-concepts
sudo docker compose up --build -d
```

The web build writes maximum-compression `.gz` versions of JavaScript, CSS,
HTML, and SVG files. The bundled NGINX uses `gzip_static` to serve these when
the browser accepts gzip, preserving the original files for other clients.
`gzip_types` also enables compression for JavaScript, CSS, JSON, and SVG
responses without a precompressed file. This setup uses gzip; the standard
NGINX image does not include a Brotli module.

The C++ IDE and its styles load when opened. Three.js is a separate hashed
chunk so lesson/UI changes can reuse the browser's cached renderer. Hashed
assets remain immutable; HTML revalidates so a fresh page receives the current
asset and worker URLs. Rebuild the web container to apply these delivery changes.
After a local build and Docker startup, `npm run test:delivery` checks the wire
sizes, decompressed content, MIME types, compression negotiation, and caching.

### Security and resource controls

The app trusts forwarded client IPs only from `TRUSTED_PROXY`, defaulting to the
shared Caddy container `reverse-proxy-caddy-1` on the VPS. Local startup trusts
only loopback. If your proxy container has a different name, set its exact Docker
DNS name in `.env`; do not use the whole shared network or `0.0.0.0/0`. The proxy
must sanitize incoming forwarded headers (Caddy does this by default). NGINX
resolves this trusted hostname on startup: after recreating Caddy, restart the
app's web container to refresh the trusted IP. The configured proxy must be
running and attached to `pixelware-proxy` before starting the web container.

The compile endpoint accepts JSON POSTs only, limits each client to 6 requests
per minute and the whole site to 30 per minute, with a burst of 6 each. It allows
2 concurrent requests per client and 8 overall; the compiler itself still runs
one compilation at a time and accepts at most 16 request threads. Header/body
read timeouts, container limits, and whole-process-group cleanup bound stalled
requests and compiler/linker processes. Rate limits include cache hits.

Browser responses enforce a same-origin CSP (including workers), prohibit
embedding, and restrict browser permissions. `wasm-unsafe-eval` permits the lab's
WebAssembly; arbitrary JavaScript eval and inline scripts remain blocked. Inline
styles are needed by the dynamic editor, tooltips, and resize controls.

Successful compilation results use an in-memory LRU cache: maximum 32 entries,
16 MiB, and 10 minutes per entry. Keys include the exact source, WASI SDK version,
compiler flags, and instrumentation files. Failed compilations are not cached;
restarts clear the cache. Compiled output omits unused DWARF debug sections while
retaining the independent source-line checkpoints. Source and output are not
written to request logs.

Rendering stops submitting GPU frames when paused and settled, suspends the
animation loop in hidden tabs, and reuses static shadows. Sustained slow frames
reduce resolution/shadow size; sustained fast frames recover gradually.

Both services rotate Docker logs (3 × 10 MB per service). On the VPS, inspect
`sudo docker compose logs --since 1h cpp-compiler` for JSON status, cache, and
duration records and `sudo docker compose logs --since 1h systems-lab` for NGINX
429/408/413 rejections. `sudo docker stats --no-stream` shows CPU/memory pressure.
These are local operational logs, not an external alerting service.

To update after pulling these changes:

```sh
cd /var/www/cpp-systems-concepts
sudo docker compose up --build -d
sudo docker compose exec systems-lab nginx -t
sudo docker compose ps
```

Periodically run `npm audit` and rebuild with `docker compose build --pull --no-cache`
to pick up patched base-image packages, then `docker compose up -d`. Test in a
local/staging stack before deploying dependency or SDK updates.

Local verification:

```sh
npm test && npm run build
docker compose up --build -d
docker compose exec -T cpp-compiler python3 - < scripts/test-server.py
CPP_LAB_DIRECT=1 npm run test:cpp
npm run test:delivery
```

On PowerShell use `Get-Content -Raw scripts/test-server.py | docker compose exec
-T cpp-compiler python3 -` and set `$env:CPP_LAB_DIRECT='1'` before the C++ tests.
The delivery test deliberately exhausts the local compile rate burst; wait for
its budget to recover before compiling interactively.

Caddy runs independently and normally needs no changes when an app is updated. Its configuration, operational README, migration report, and rollback script are in `/var/www/reverse-proxy`. The existing external certificate volumes were preserved. Caddy obtained Let's Encrypt certificates for both systems hostnames and renews them automatically; no Certbot setup is needed here.

See [the migration report](deploy/VPS-MIGRATION-REPORT.md) for the files changed, validation, backups, and recovery commands.

## Alternative setup: existing Docker NGINX proxy with Certbot

The following instructions are for a different hosting arrangement. They are not needed for the current Caddy VPS deployment.

The existing public NGINX proxy owns ports 80 and 443 and selects the site by hostname. It forwards this site to `systems-concepts-web:80` on a shared Docker network. TLS terminates at the proxy. The app's internal NGINX remains an HTTP static-file server.

These instructions assume plain NGINX in Docker on a Linux VPS. Preserve the existing proxy's services, networks, configuration, certificates, and renewal jobs. If your proxy already automates certificates, use that system to request both hostnames instead of adding a second Certbot setup.

## 1. DNS

At the DNS provider for `pixelware.nl`, create:

| Type | Name relative to pixelware.nl | Value |
| --- | --- | --- |
| A | systems | Your VPS public IPv4 address |
| CNAME | www.systems | systems.pixelware.nl |

Wait until both names resolve to the VPS. Publish an AAAA record only if the proxy is reachable over that IPv6 address. Ensure the VPS/provider firewalls allow public TCP 80 and 443. HTTP-01 certificate validation requires port 80.

Both hostnames need certificate coverage, including the redirecting hostname. A `*.pixelware.nl` certificate alone does not cover `www.systems.pixelware.nl`. The final configuration serves `systems.pixelware.nl` and redirects `www.systems.pixelware.nl` to it.

## 2. Connect the app to the proxy network

Find the existing proxy container and its networks:

```sh
docker ps --format 'table {{.Names}}\t{{.Ports}}'
docker inspect YOUR_PROXY_CONTAINER --format '{{json .NetworkSettings.Networks}}'
```

Copy this project onto the VPS, then run from the project directory. Replace `YOUR_EXISTING_PROXY_NETWORK` with a network shown above:

```sh
export PROXY_NETWORK=YOUR_EXISTING_PROXY_NETWORK
export TRUSTED_PROXY=YOUR_EXISTING_PROXY_CONTAINER
docker compose -p systems-concepts -f compose.vps.yaml up --build -d
```

Use this standalone Compose file for future builds, too. Do not combine it with `compose.yaml`. The VPS file has no published app port, so the other project's port mappings can remain in place. The app is reachable by the alias `systems-concepts-web` on the chosen network. You can save `PROXY_NETWORK=...` in a project `.env` file instead of exporting it each session.

## 3. Add persistent certificate and challenge mounts to the proxy

The following example uses separate directories for this site's TLS files:

```sh
sudo mkdir -p /opt/systems-tls/letsencrypt /opt/systems-tls/webroot
```

Add these entries to the existing proxy service's `volumes` list in its Compose file, keeping all existing entries:

```yaml
volumes:
  - /opt/systems-tls/letsencrypt:/etc/letsencrypt-systems:ro
  - /opt/systems-tls/webroot:/var/www/certbot-systems:ro
```

Save `deploy/nginx/systems.http.conf` as `systems.conf` in the existing proxy's mounted configuration directory, normally the directory mounted to `/etc/nginx/conf.d`. Add only the bootstrap file initially; do not load the HTTPS example yet. The certificate files do not exist at this stage.

From the existing proxy project's directory, apply the mount changes using its usual Compose command (`docker compose up -d YOUR_PROXY_SERVICE`). Adding mounts recreates that service, so schedule this brief proxy interruption appropriately. For subsequent site configuration changes, reload NGINX instead:

```sh
docker exec YOUR_PROXY_CONTAINER nginx -t
# Run only if the configuration test succeeds:
docker exec YOUR_PROXY_CONTAINER nginx -s reload
```

If the proxy mounts individual files rather than a directory, also add a persistent bind mount for the new `systems.conf`. Keep the existing site's configuration in place.

Check that `http://systems.pixelware.nl` and `http://www.systems.pixelware.nl` show this application before requesting the certificate.

## 4. Obtain a Let's Encrypt certificate

Run on the VPS, replacing the email with yours:

```sh
docker run --rm -it \
  -v /opt/systems-tls/letsencrypt:/etc/letsencrypt \
  -v /opt/systems-tls/webroot:/var/www/certbot-systems \
  certbot/certbot certonly --webroot \
  -w /var/www/certbot-systems \
  --cert-name systems.pixelware.nl \
  -d systems.pixelware.nl \
  -d www.systems.pixelware.nl \
  --email YOUR_EMAIL_ADDRESS
```

Follow the interactive prompts. This method writes challenge files for the running proxy to serve, so Certbot does not need to bind port 80 or stop NGINX. Its Docker image obtains the certificate; it does not modify the proxy configuration.

## 5. Enable HTTPS

Replace the contents of the proxy's `systems.conf` with `deploy/nginx/systems.https.conf`. Do not load both example files together. Test and reload:

```sh
docker exec YOUR_PROXY_CONTAINER nginx -t
# Run only if the configuration test succeeds:
docker exec YOUR_PROXY_CONTAINER nginx -s reload
curl -I https://systems.pixelware.nl
curl -I https://www.systems.pixelware.nl
```

The first URL should return 200; the second should redirect to `https://systems.pixelware.nl`. HTTP redirects to HTTPS while the challenge URL remains available for renewal. Docker's DNS resolver in the examples also lets the proxy pick up a changed app container IP after a rebuild.

## 6. Automatic renewal

Test renewal first:

```sh
docker run --rm \
  -v /opt/systems-tls/letsencrypt:/etc/letsencrypt \
  -v /opt/systems-tls/webroot:/var/www/certbot-systems \
  certbot/certbot renew --dry-run
```

For this separate Certbot setup, add the following to root's crontab (`sudo crontab -e`), replacing `YOUR_PROXY_CONTAINER`. Ensure `docker` is on cron's PATH (or replace it with its absolute executable path from `command -v docker`):

```cron
17 3,15 * * * docker run --rm -v /opt/systems-tls/letsencrypt:/etc/letsencrypt -v /opt/systems-tls/webroot:/var/www/certbot-systems certbot/certbot renew --quiet && docker exec YOUR_PROXY_CONTAINER nginx -t && docker exec YOUR_PROXY_CONTAINER nginx -s reload
```

This checks twice daily and reloads the proxy after a successful run so it reads renewed certificates. Check cron output/logs for failures. Preserve the other project's renewal schedule. If an existing certificate manager handles these names, keep its renewal process instead.

## References

- [NGINX hostname routing](https://nginx.org/en/docs/http/request_processing.html)
- [Docker Compose networking](https://docs.docker.com/compose/how-tos/networking/)
- [Certbot Docker installation](https://eff-certbot.readthedocs.io/en/stable/install.html#alternative-1-docker)
- [Certbot webroot and renewal](https://eff-certbot.readthedocs.io/en/stable/using.html)
- [Let's Encrypt validation methods](https://letsencrypt.org/docs/challenge-types/)
