#!/usr/bin/env bash
# Install REA's analysis engines on Linux (x86_64):
#   - Ghidra 12.1.4 (SHA-256 verified)            -> $ENGINES/ghidra_12.1.4_PUBLIC
#   - jadx-headless-mcp 0.7.1                      -> $ENGINES/jadx-headless-mcp-0.7.1-all.jar
#   - apt tools (radare2, binwalk, tshark, apktool, binutils, gdb) when apt-get is available
#
# Idempotent: already-installed pieces are skipped. Safe to use as a claude.ai cloud
# environment "setup script", as a SessionStart hook, in a Dockerfile, or by hand.
#
# Environment:
#   REA_PLUGIN_ENGINES_DIR   target directory (default ~/.rea-engines)
#   REA_PLUGIN_SKIP_APT=1    do not touch apt
#   REA_PLUGIN_SKIP_JADX=1   skip jadx
# Flags:
#   --background   log-friendly mode used by launch-rea.cjs (writes install.lock / install.done)
#   --no-apt       same as REA_PLUGIN_SKIP_APT=1
set -euo pipefail

ENGINES="${REA_PLUGIN_ENGINES_DIR:-$HOME/.rea-engines}"
GHIDRA_VERSION="12.1.4"
GHIDRA_ZIP="ghidra_12.1.4_PUBLIC_20260921.zip"
GHIDRA_URL="https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/${GHIDRA_ZIP}"
GHIDRA_SHA256="ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db"
GHIDRA_DIR="${ENGINES}/ghidra_${GHIDRA_VERSION}_PUBLIC"
JADX_JAR="jadx-headless-mcp-0.7.1-all.jar"
JADX_URL="https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/${JADX_JAR}"

BACKGROUND=0
for arg in "$@"; do
  case "$arg" in
    --background) BACKGROUND=1 ;;
    --no-apt) export REA_PLUGIN_SKIP_APT=1 ;;
    -h|--help) sed -n 2,20p "$0"; exit 0 ;;
  esac
done

mkdir -p "$ENGINES"
LOCK="${ENGINES}/install.lock"
DONE="${ENGINES}/install.done"
cleanup() { rm -f "$LOCK"; }
trap cleanup EXIT
echo "$$" > "$LOCK"

log() { printf '[install-engines %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# ---- Java ------------------------------------------------------------------
if need_cmd java && java -version 2>&1 | grep -qE 'version "(2[1-9]|[3-9][0-9])'; then
  log "java: $(java -version 2>&1 | head -1)"
else
  log "JDK 21+ not found."
  if [ "${REA_PLUGIN_SKIP_APT:-0}" != "1" ] && need_cmd apt-get; then
    log "installing openjdk-21-jdk-headless via apt"
    (sudo -n true 2>/dev/null && SUDO=sudo || SUDO="") ; ${SUDO:-} apt-get install -y -qq openjdk-21-jdk-headless >/dev/null 2>&1 || log "apt install of JDK failed; install JDK 21+ manually"
  else
    log "install a 64-bit JDK 21+ and make sure 'java' and 'javac' are on PATH"
  fi
fi

# ---- Ghidra -----------------------------------------------------------------
if [ -x "${GHIDRA_DIR}/support/analyzeHeadless" ]; then
  log "ghidra ${GHIDRA_VERSION} already installed at ${GHIDRA_DIR}"
else
  log "downloading Ghidra ${GHIDRA_VERSION} (~570 MB) ..."
  tmp="${ENGINES}/.${GHIDRA_ZIP}.part"
  curl -fL --retry 3 --retry-delay 5 -o "$tmp" "$GHIDRA_URL"
  echo "${GHIDRA_SHA256}  ${tmp}" | sha256sum -c - >/dev/null
  log "sha256 verified; extracting"
  rm -rf "${GHIDRA_DIR}.tmp"
  mkdir -p "${GHIDRA_DIR}.tmp"
  unzip -q "$tmp" -d "${GHIDRA_DIR}.tmp"
  mv "${GHIDRA_DIR}.tmp/ghidra_${GHIDRA_VERSION}_PUBLIC" "$GHIDRA_DIR"
  rm -rf "${GHIDRA_DIR}.tmp" "$tmp"
  log "ghidra installed at ${GHIDRA_DIR}"
fi

# ---- jadx-headless-mcp --------------------------------------------------------
if [ "${REA_PLUGIN_SKIP_JADX:-0}" = "1" ]; then
  log "skipping jadx"
elif [ -s "${ENGINES}/${JADX_JAR}" ]; then
  log "jadx-headless-mcp already present"
else
  log "downloading jadx-headless-mcp 0.7.1 (~40 MB) ..."
  curl -fL --retry 3 --retry-delay 5 -o "${ENGINES}/.${JADX_JAR}.part" "$JADX_URL"
  mv "${ENGINES}/.${JADX_JAR}.part" "${ENGINES}/${JADX_JAR}"
  log "jadx-headless-mcp installed"
fi

# ---- apt tools -------------------------------------------------------------------
if [ "${REA_PLUGIN_SKIP_APT:-0}" != "1" ] && need_cmd apt-get; then
  missing=()
  for pkg in binutils gdb radare2 binwalk tshark apktool unzip procps; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    log "installing apt tools: ${missing[*]}"
    (sudo -n true 2>/dev/null && SUDO=sudo || SUDO="")
    export DEBIAN_FRONTEND=noninteractive
    ${SUDO:-} apt-get update -qq >/dev/null 2>&1 || true
    ${SUDO:-} apt-get install -y -qq "${missing[@]}" >/dev/null 2>&1 || log "some apt tools failed to install (non-fatal)"
  else
    log "apt tools already installed"
  fi
fi

date -u +%Y-%m-%dT%H:%M:%SZ > "$DONE"
log "done. GHIDRA_INSTALL_DIR=${GHIDRA_DIR}  REA_JADX_MCP_JAR=${ENGINES}/${JADX_JAR}"
if [ "$BACKGROUND" = "1" ]; then
  log "REA picks these up on the next open_binary call; no restart needed."
fi
