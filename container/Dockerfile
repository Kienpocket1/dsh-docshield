# One user's DeepSeek Harness + DocShield, started by dsh-gate (GATE_RUNTIME=docker).
# Build from the repo root after `npm run build` in docshield/:
#   docker build -f container/Dockerfile -t docshield-dsh:dev .
FROM node:24-bookworm-slim

ARG DSH_VERSION=0.1.6-alpha.2
ENV NODE_ENV=production npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false

# iptables for the network lockdown done at start (container/firewall.mjs).
RUN apt-get update && apt-get install -y --no-install-recommends iptables && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/dsh
RUN npm init -y >/dev/null && npm install --omit=dev "@deepseek-ai/dsh@${DSH_VERSION}" && npm cache clean --force

# DocShield embeds through the gate's shared service, so the in-process model (transformers) is left out.
WORKDIR /opt/docshield
COPY docshield/package.json ./
RUN npm pkg delete devDependencies "dependencies.@huggingface/transformers" \
 && npm install --omit=dev && npm cache clean --force
COPY docshield/cordis.yml ./
COPY docshield/presets ./presets
COPY docshield/dist ./dist
# S4: "DocShield + công cụ" presets = this DSH's Standard tool rows + DocShield persona and tools.
COPY container/make-harness-presets.mjs /tmp/
RUN node /tmp/make-harness-presets.mjs /opt/dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard ./presets && rm /tmp/make-harness-presets.mjs

# Profile packages shared by every home; DSH_HOME itself is a per-user volume.
RUN mkdir -p /opt/profile-web/node_modules \
 && ln -s /opt/docshield /opt/profile-web/node_modules/dsh-docshield \
 && mkdir -p /home/dsh /storage && chown node:node /home/dsh /storage
COPY container/start.sh container/firewall.mjs container/entrypoint.mjs /opt/
RUN chmod 755 /opt/start.sh

# Starts as root only to set the firewall; start.sh then execs entrypoint.mjs as node with no capabilities.
ENV DSH_HOME=/home/dsh
EXPOSE 3090
ENTRYPOINT ["/opt/start.sh"]
