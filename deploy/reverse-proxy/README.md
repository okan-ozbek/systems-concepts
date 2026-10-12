# Shared VPS proxy configuration

These files mirror the independent Caddy stack running at `/var/www/reverse-proxy` on the VPS. The application continues to run locally at `http://localhost:8080` using the root `compose.yaml`.

The shared proxy serves `pixelware.nl` and `systems.pixelware.nl`, redirects both `www` hostnames to their canonical domains, and manages HTTPS certificates automatically. It connects to the external Docker network `pixelware-proxy` and reuses the existing external certificate volumes declared in `compose.yaml`.

To start this proxy on the configured VPS:

```sh
cd /var/www/reverse-proxy
sudo docker compose up -d
```

After updating its Caddyfile, validate and reload:

```sh
sudo docker exec reverse-proxy-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker exec reverse-proxy-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

The network and certificate volumes already exist on the VPS. See [the migration report](../VPS-MIGRATION-REPORT.md) for backups and recovery instructions.
