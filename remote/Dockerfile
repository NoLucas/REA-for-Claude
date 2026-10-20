# REA appliance: Linux container with REA 6.7.0 + Ghidra 12.1.4 + jadx-headless-mcp +
# radare2/binwalk/tshark/apktool, served as a Streamable HTTP MCP endpoint.
#
#   docker build -t rea-appliance -f remote/Dockerfile .
#   docker run -p 8765:8765 -v "$PWD/targets:/targets" -e REA_PATH_SECRET=<random> rea-appliance
#   -> MCP endpoint: http://localhost:8765/<secret>/mcp   (put HTTPS + tunnel in front, see remote/README.md)
#
# Build context must be the repository root (needs scripts/install-engines.sh).

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip gnupg procps python3 \
      openjdk-21-jdk-headless \
      binutils gdb radare2 binwalk tshark apktool \
 && rm -rf /var/lib/apt/lists/*

# Node.js 22 (REA requires 22.19+, 24.11+, or 26+)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Engines (Ghidra is SHA-256 verified by the script)
COPY scripts/install-engines.sh /opt/rea/install-engines.sh
RUN REA_PLUGIN_ENGINES_DIR=/opt/rea/engines REA_PLUGIN_SKIP_APT=1 bash /opt/rea/install-engines.sh

# REA + stdio->HTTP bridge, pinned
RUN npm install -g rea-agents@6.7.0 supergateway@4.2.0 && npm cache clean --force

ENV GHIDRA_INSTALL_DIR=/opt/rea/engines/ghidra_12.1.4_PUBLIC \
    REA_JADX_MCP_JAR=/opt/rea/engines/jadx-headless-mcp-0.7.1-all.jar \
    REA_GHIDRA_STARTUP_TIMEOUT_MS=900000 \
    REA_PATH_SECRET=change-me \
    PORT=8765

# Drop privileges; /targets is where you put files to analyse
RUN useradd -m -u 10001 rea && mkdir -p /targets && chown rea:rea /targets
USER rea
WORKDIR /home/rea
VOLUME ["/targets"]
EXPOSE 8765

COPY --chown=rea:rea remote/entrypoint.sh /opt/rea/entrypoint.sh
ENTRYPOINT ["bash", "/opt/rea/entrypoint.sh"]
