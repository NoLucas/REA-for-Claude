#!/usr/bin/env bash
# Serve REA over Streamable HTTP at /<REA_PATH_SECRET>/mcp via supergateway.
set -euo pipefail

if [ "${REA_PATH_SECRET:-change-me}" = "change-me" ]; then
  echo "[rea-appliance] REA_PATH_SECRET is still 'change-me'. Set a long random value:" >&2
  echo "[rea-appliance]   docker run -e REA_PATH_SECRET=\$(openssl rand -hex 24) ..." >&2
  exit 1
fi

echo "[rea-appliance] rea $(rea --help 2>/dev/null | head -1 | sed 's/ —.*//')" >&2
echo "[rea-appliance] MCP endpoint: http://0.0.0.0:${PORT:-8765}/${REA_PATH_SECRET}/mcp" >&2
echo "[rea-appliance] targets volume: /targets" >&2

exec supergateway \
  --stdio "rea mcp" \
  --outputTransport streamableHttp \
  --port "${PORT:-8765}" \
  --streamableHttpPath "/${REA_PATH_SECRET}/mcp" \
  --logLevel info
