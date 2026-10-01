/** Gate configuration: defaults for this machine, overridable by environment variables. */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Docker Desktop on this machine is installed on E: and its CLI is not always on PATH.
const DOCKER_DESKTOP_BIN = 'E:/Docker/DockerDesktop/resources/bin/docker.exe'
const env = process.env

export function loadConfig() {
  const embedPort = Number(env.GATE_EMBED_PORT ?? 3490)
  const docshieldPort = Number(env.GATE_DOCSHIELD_PORT ?? 3492)
  const llmPort = Number(env.GATE_LLM_PORT ?? 3494)
  const varDir = path.resolve(env.GATE_VAR_DIR ?? path.join(root, 'var'))
  return {
    host: env.GATE_HOST ?? '127.0.0.1',
    port: Number(env.GATE_PORT ?? 3444),
    // Set to 1 when a local tunnel (cloudflared) forwards internet traffic to the gate.
    trustProxy: env.GATE_TRUST_PROXY === '1',
    varDir,
    instances: {
      dshBin: env.GATE_DSH_BIN ?? 'E:/Deepseek_Harness/spike-dshpw/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js',
      homesDir: path.join(varDir, 'homes'),
      templateHome: env.GATE_TEMPLATE_HOME ?? 'E:/Deepseek_Harness/spike-dshpw/dsh-home',
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-docshield'],
      idleMs: Number(env.GATE_IDLE_MINUTES ?? 30) * 60_000,
      // docker = one container per user (image from container/Dockerfile); local = plain child process.
      runtime: env.GATE_RUNTIME === 'docker' ? 'docker' : 'local',
      docker: {
        bin: env.GATE_DOCKER_BIN ?? (existsSync(DOCKER_DESKTOP_BIN) ? DOCKER_DESKTOP_BIN : 'docker'),
        image: env.GATE_DOCKER_IMAGE ?? 'docshield-dsh:dev',
        templateDir: path.join(varDir, 'docker-template'),
        // The host DocShield service as seen from inside a container.
        serviceUrl: `http://host.docker.internal:${docshieldPort}`,
        // The gate's model proxy (holds the real API keys) as seen from inside a container.
        llmUrl: `http://host.docker.internal:${llmPort}`,
        // The only host ports a container may connect to (its firewall drops the rest).
        hostPorts: [docshieldPort, llmPort],
        // 1 = containers may also reach the public internet (never the host's other ports or the LAN).
        internet: env.GATE_DOCKER_INTERNET === '1',
        memory: env.GATE_DOCKER_MEMORY ?? '1g',
        cpus: env.GATE_DOCKER_CPUS ?? '2',
      },
      docshield: {
        storageRoot: env.DOCSHIELD_STORAGE_ROOT ?? 'E:/Deepseek_Harness/spike-dshpw/storage',
        embedUrl: `http://127.0.0.1:${embedPort}/embed`,
      },
    },
    embed: {
      script: env.GATE_EMBED_SCRIPT ?? path.join(root, '..', 'docshield', 'scripts', 'embed-server.mjs'),
      port: embedPort,
      // bge-m3 files; default <storage>/.docshield/models.
      models: env.GATE_EMBED_MODELS,
    },
    // Docker mode only: the one process that opens the DocShield database (docshield/scripts/docshield-server.mjs).
    llmProxyPort: llmPort,
    docshieldServer: {
      script: path.join(root, '..', 'docshield', 'scripts', 'docshield-server.mjs'),
      port: docshieldPort,
    },
  }
}
