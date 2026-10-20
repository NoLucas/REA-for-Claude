#!/usr/bin/env bash
# Build the Claude Desktop extension (.mcpb) for THIS operating system.
#
#   bash desktop/build-mcpb.sh            -> dist/rea-for-claude-<os>-<arch>.mcpb
#
# rea-agents has platform-specific native dependencies (node-pty, optional frida), so the
# bundle must be built on the OS it will be installed on (macOS/Linux here; Windows users
# run desktop/build-mcpb.ps1). Requires Node 22+ and npm.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
STAGE="$ROOT/desktop/.stage"
REA_VERSION="${REA_VERSION:-6.7.0}"

rm -rf "$STAGE"; mkdir -p "$STAGE/server" "$ROOT/dist"
cp desktop/manifest.json "$STAGE/manifest.json"
cp scripts/launch-rea.cjs "$STAGE/server/launch-rea.cjs"
cp LICENSE "$STAGE/LICENSE"
[ -f desktop/icon.png ] && cp desktop/icon.png "$STAGE/icon.png" || true

echo "[build-mcpb] installing rea-agents@${REA_VERSION} into the bundle (this OS only)"
( cd "$STAGE/server" && npm init -y >/dev/null && npm install --omit=dev --no-audit --no-fund "rea-agents@${REA_VERSION}" >/dev/null )
# frida is optional and large; drop it unless explicitly kept
[ "${KEEP_FRIDA:-0}" = "1" ] || rm -rf "$STAGE/server/node_modules/frida"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"; case "$os" in darwin) os=darwin;; linux) os=linux;; *) os="$os";; esac
arch="$(uname -m)"; case "$arch" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; esac
OUT="$ROOT/dist/rea-for-claude-${os}-${arch}.mcpb"

echo "[build-mcpb] validating manifest"
npx -y @anthropic-ai/mcpb validate "$STAGE/manifest.json"
echo "[build-mcpb] packing -> $OUT"
npx -y @anthropic-ai/mcpb pack "$STAGE" "$OUT"
npx -y @anthropic-ai/mcpb info "$OUT" | head -20
rm -rf "$STAGE"
echo "[build-mcpb] done. Install: Claude Desktop → Settings → Extensions → Advanced → Install Extension… → $OUT"
