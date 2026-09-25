/** Gate configuration: defaults for this machine, overridable by environment variables. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = process.env

export function loadConfig() {
  const embedPort = Number(env.GATE_EMBED_PORT ?? 3490)
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
      docshield: {
        storageRoot: env.DOCSHIELD_STORAGE_ROOT ?? 'E:/Deepseek_Harness/spike-dshpw/storage',
        embedUrl: `http://127.0.0.1:${embedPort}/embed`,
      },
    },
    embed: {
      script: env.GATE_EMBED_SCRIPT ?? path.join(root, '..', 'scripts', 'embed-server.mjs'),
      port: embedPort,
    },
  }
}
