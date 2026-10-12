# VPS migration report - 12 October 2026

The shared Caddy reverse proxy now runs independently in /var/www/reverse-proxy.
The portfolio and Systems Concepts remain separate Docker Compose projects.

## Changes

- Created /var/www/reverse-proxy/compose.yaml and Caddyfile.
- Created the shared Docker network pixelware-proxy.
- Started reverse-proxy-caddy-1; it owns public TCP 80/443 and UDP 443.
- Reused external volumes oo-portfolio_caddy_data and oo-portfolio_caddy_config,
  preserving the existing certificate storage and ACME account.
- Removed the https service from /var/www/oo-portfolio/compose.yaml.
  The portfolio keeps its original private default network and also joins the
  proxy network using the alias portfolio-web.
- Updated /var/www/cpp-systems-concepts/.env to PROXY_NETWORK=pixelware-proxy.
  The app joins the proxy network as systems-concepts-web.
- Updated the Systems Concepts Compose missing-network message to mention Caddy.
- Removed the stopped oo-portfolio-https-1 container after successful verification.
- Obtained Let's Encrypt certificates for systems.pixelware.nl and
  www.systems.pixelware.nl. Caddy manages their renewal automatically.
- Saved operating instructions in README.md and a rollback script in rollback.py.

## Routing

- pixelware.nl -> portfolio-web:8080
- systems.pixelware.nl -> systems-concepts-web:80
- www.systems.pixelware.nl -> https://systems.pixelware.nl (301)
- HTTP automatically redirects to HTTPS (308).

## Validation

- Both app containers are healthy.
- Caddy can reach both app upstreams; both return HTTP 200.
- Portfolio HTTPS returns HTTP 200 with successful certificate verification.
- Systems Concepts HTTPS returns HTTP 200 with successful certificate verification.
- The www HTTPS hostname returns HTTP 301 to the canonical systems hostname.
- Caddy logs confirm successful Let's Encrypt issuance for both new hostnames.
- Authoritative DNS and Cloudflare DNS resolve both names to 141.138.138.194.
- Public browser verification loaded the deployed Systems Concepts application.

## Routine deployment

From each application's directory:
    sudo docker compose up --build -d

Start or update the shared proxy:
    cd /var/www/reverse-proxy
    sudo docker compose up -d

After editing its Caddyfile, validate and reload:
    sudo docker exec reverse-proxy-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    sudo docker exec reverse-proxy-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

## Recovery

Original configuration and staged replacements are saved at:
    /var/www/reverse-proxy/backups/20261012T005259Z

Restore the original portfolio-owned proxy and original app network configuration:
    sudo python3 /var/www/reverse-proxy/rollback.py

Rollback switches the active public proxy and briefly interrupts public traffic.
Certificate volumes are preserved. Do not delete these shared external volumes.

## Repository maintenance

The portfolio Compose file is modified on the VPS. Preserve its new proxy-network
configuration in the portfolio repository before future updates; the old https
service must stay removed. The Systems Concepts .env is deployment-specific.
No Git commits or pushes were made during the migration.

## Follow-up: www.pixelware.nl

Added a missing Caddy route on 12 October 2026:
www.pixelware.nl -> https://pixelware.nl (301).
Its DNS CNAME, IPv4, and IPv6 records already pointed to this VPS.
Caddy obtained a valid Let's Encrypt certificate and will renew it automatically.
Verified the redirect with certificate verification enabled, followed it to
pixelware.nl (HTTP 200), and confirmed Systems Concepts still returns HTTP 200.
The public browser also followed www.pixelware.nl to the portfolio successfully.
The previous Caddyfile is saved in backups/20261012T010142Z-www/Caddyfile.
