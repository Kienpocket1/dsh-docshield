import { appendFileSync } from 'node:fs'
const FILE = 'E:/Deepseek_Harness/spike-dshpw/probe.log'
export function log(tag, value) {
  let text
  try { text = JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? String(v) : v) } catch (e) { text = String(e) }
  if (text && text.length > 4000) text = text.slice(0, 4000) + '…'
  appendFileSync(FILE, `${new Date().toISOString()} [${tag}] ${text}\n`)
}
