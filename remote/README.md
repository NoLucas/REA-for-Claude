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

## 3. Supplying targets

`/targets` inside the container is mounted from `remote/targets/` on the host. Copy the files
you want to analyse there and ask Claude to open `/targets/<name>`.

## Security — please read

- This endpoint is **a server that opens arbitrary binaries and can run gdb, Playwright and
  process capture**. Anyone who knows the URL can use it, so `REA_PATH_SECRET` must be long
  and random, and must never be shared. (The claude.ai connector UI has no custom-header field,
  so a path secret is the simplest option.)
- To do it properly, add OAuth: Cloudflare Zero Trust's MCP server portals / Access, or an
  OAuth 2.1 gateway such as `fastmcp` or `mcp-auth` in front of supergateway, with the Client
  ID / Secret entered under the connector's "Advanced settings".
- A quick tunnel changes its hostname on every restart. Use a named tunnel for a stable
  hostname.
- On your own server, mount nothing besides `-v ./targets:/targets`. The container runs as the
  unprivileged `rea` user.

## Verification status

- `scripts/install-engines.sh` (Ghidra 12.1.4 with SHA-256 check, jadx, apt tools), REA 6.7.0 +
  Ghidra decompilation, and the supergateway stdio → Streamable HTTP bridge were all executed
  and confirmed in an Ubuntu 24.04 container.
- `docker build` itself and the Cloudflare tunnel could not be run in that environment (no
  Docker). If the first run misbehaves, check `docker compose logs rea`.
