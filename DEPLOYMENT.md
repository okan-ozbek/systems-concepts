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
```

The same settings are supplied in `.env.vps.example`. Use that file as `.env` on the VPS. Local Docker startup uses the root `compose.yaml` and serves `http://localhost:8080`.

The current shared proxy [Compose file](deploy/reverse-proxy/compose.yaml) and [Caddyfile](deploy/reverse-proxy/Caddyfile) are also saved in this repository, including both `www` redirects. The proxy runs independently from the app. Systems Concepts uses the same bundled Pixelware SVG favicon as the portfolio.

To update this app:

```sh
cd /var/www/cpp-systems-concepts
sudo docker compose up --build -d
```

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
