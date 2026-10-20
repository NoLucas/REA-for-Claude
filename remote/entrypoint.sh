#!/usr/bin/env bash
# Serve REA over Streamable HTTP.
#
# Transport selection (automatic):
#   1. If the installed rea-agents understands `rea mcp --http` (on REA main; not yet in
#      npm 6.7.0), serve natively on 0.0.0.0:$PORT and let the gateway/tunnel in front
#      handle the path/auth. REA's native listener relaxes Host checks on a non-loopback bind.
#   2. Otherwise bridge stdio -> Streamable HTTP with supergateway.
# Force one with REA_HTTP_MODE=native|bridge.
#
# Auth modes:
#   - path secret (default): endpoint is /<REA_PATH_SECRET>/mcp  (bridge mode only)
#   - behind oauth-gateway  : set REA_UPSTREAM_API_KEY; the endpoint is /mcp and callers
#                            must present `Authorization: Bearer $REA_UPSTREAM_API_KEY`
#                            (the gateway does this for you). docker-compose.oauth.yml uses this.
set -euo pipefail

PORT="${PORT:-8765}"
MODE="${REA_HTTP_MODE:-auto}"

native_supported() {
  # Published 6.7.0 answers COMMAND_NOT_FOUND ("'--http' is not a command"); main prints
  # the --http usage with its --host/--port options. Require the latter, reject the former.
  local out
  out="$(rea mcp --http --help 2>&1 || true)"
  ! grep -q 'COMMAND_NOT_FOUND\|is not a command' <<<"$out" && grep -q -- '--port' <<<"$out"
}

if [ "$MODE" = "auto" ]; then
  if native_supported; then MODE=native; else MODE=bridge; fi
fi
echo "[rea-appliance] transport: ${MODE}" >&2
echo "[rea-appliance] targets volume: /targets" >&2

if [ "$MODE" = "native" ]; then
  if [ -n "${REA_UPSTREAM_API_KEY:-}" ]; then
    echo "[rea-appliance] WARNING: native mode has no built-in bearer check; keep it behind oauth-gateway on a private network." >&2
  fi
  echo "[rea-appliance] MCP endpoint: http://0.0.0.0:${PORT}/mcp (native rea mcp --http)" >&2
  exec rea mcp --http --host 0.0.0.0 --port "${PORT}"
fi

# ---- bridge mode ----
if [ -n "${REA_UPSTREAM_API_KEY:-}" ]; then
  echo "[rea-appliance] MCP endpoint: http://0.0.0.0:${PORT}/mcp  (bearer required: REA_UPSTREAM_API_KEY)" >&2
  exec supergateway --stdio "rea mcp" --outputTransport streamableHttp --port "${PORT}" \
    --streamableHttpPath "/mcp" --apiKey "${REA_UPSTREAM_API_KEY}" --logLevel info
fi

if [ "${REA_PATH_SECRET:-change-me}" = "change-me" ]; then
  echo "[rea-appliance] REA_PATH_SECRET is still 'change-me'. Set a long random value:" >&2
  echo "[rea-appliance]   docker run -e REA_PATH_SECRET=\$(openssl rand -hex 24) ..." >&2
  exit 1
fi
echo "[rea-appliance] MCP endpoint: http://0.0.0.0:${PORT}/${REA_PATH_SECRET}/mcp" >&2
exec supergateway --stdio "rea mcp" --outputTransport streamableHttp --port "${PORT}" \
  --streamableHttpPath "/${REA_PATH_SECRET}/mcp" --logLevel info
