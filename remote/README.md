<p align="right"><b>English</b> | <a href="README.ko.md">한국어</a></p>

# REA remote appliance (phone, web — anywhere)

Use this when you want REA with your PC switched off, or from your phone. REA and all of its
engines are baked into a Linux container, exposed as a Streamable HTTP MCP endpoint, and
registered in claude.ai as a **custom connector**. Windows compatibility issues disappear too,
because the container is Linux.

```
claude.ai (web/phone/desktop) ──HTTPS──▶ Cloudflare tunnel ──▶ supergateway ──stdio──▶ rea mcp
                                                                   (container: Ghidra, jadx, radare2 …)
```

## 1. Build and run

On Docker Desktop (WSL2 backend) or any Linux server:

```bash
cd remote
export REA_PATH_SECRET=$(openssl rand -hex 24)
docker compose up --build        # first build downloads Ghidra (570 MB); 5–10 minutes
```

The `tunnel` service logs a URL like `https://xxxx-xxxx.trycloudflare.com`.

## 2. Register it in claude.ai

**Settings → Connectors → Add custom connector**, with this URL:

```
https://xxxx-xxxx.trycloudflare.com/<REA_PATH_SECRET>/mcp
```

The REA tools are then available in every claude.ai conversation (web, mobile, desktop) and in
Claude Code cloud sessions. A Pro, Max, Team or Enterprise plan is required.

## 2b. Real login instead of a path secret (OAuth 2.1)

`docker-compose.oauth.yml` puts a small OAuth 2.1 gateway (`oauth-gateway/gateway.mjs`,
no dependencies) in front of REA. claude.ai discovers it automatically (protected-resource
metadata → dynamic client registration → PKCE), shows you a login page once, and from then
on uses rotating bearer tokens. REA itself only accepts an internal key from the gateway.

```bash
cd remote
export GATEWAY_PASSWORD='a long passphrase you will type on the login page'   # >= 12 chars
export REA_UPSTREAM_API_KEY=$(openssl rand -hex 24)                           # internal only
docker compose -f docker-compose.oauth.yml up --build
# read the https://<random>.trycloudflare.com URL from the tunnel log, then once:
export PUBLIC_URL=https://<random>.trycloudflare.com && docker compose -f docker-compose.oauth.yml up -d
```

Add `https://<host>/mcp` as the custom connector. Restarting the gateway (or deleting its
state volume) revokes every token. The gateway's OAuth flow — metadata, registration,
redirect allowlist (claude.ai / claude.com only), PKCE S256, wrong-passphrase lockout,
refresh rotation and the authenticated proxy to REA — is exercised by `scripts/selftest.sh`
and was verified end to end against a live REA bridge. It has not yet been exercised by
claude.ai's own client; if the connector dialog reports an error, open an issue with the
gateway log line.

## 3. Supplying targets

`/targets` inside the container is mounted from `remote/targets/` on the host. Copy the files
you want to analyse there and ask Claude to open `/targets/<name>`.

## Security — please read

- This endpoint is **a server that opens arbitrary binaries and can run gdb, Playwright and
  process capture**. Anyone who knows the URL can use it, so `REA_PATH_SECRET` must be long
  and random, and must never be shared. (The claude.ai connector UI has no custom-header field,
  so a path secret is the simplest option.)
- Prefer the OAuth gateway (`docker-compose.oauth.yml`, section 2b) over the path secret
  whenever the endpoint stays up for more than a demo.
- A quick tunnel changes its hostname on every restart. Use a named tunnel for a stable
  hostname.
- On your own server, mount nothing besides `-v ./targets:/targets`. The container runs as the
  unprivileged `rea` user.

## Verification status

- `scripts/install-engines.sh` (Ghidra 12.1.4 with SHA-256 check, jadx, apt tools), REA 6.7.0 +
  Ghidra decompilation, and the supergateway stdio → Streamable HTTP bridge were all executed
  and confirmed in an Ubuntu 24.04 container.
- The OAuth gateway was run against a live REA bridge: full PKCE flow and an authenticated
  `initialize` through the proxy returned REA 6.7.0.
- `entrypoint.sh` auto-selects REA's native `rea mcp --http` when the installed version
  supports it (REA `main`; not yet npm 6.7.0) and falls back to the supergateway bridge
  otherwise — the detection is covered by selftest.
- `docker build` itself and the Cloudflare tunnel could not be run in that environment (no
  Docker). If the first run misbehaves, check `docker compose logs rea`.
