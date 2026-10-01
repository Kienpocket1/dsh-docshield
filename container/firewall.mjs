/**
 * Network lockdown, run as root by start.sh before it drops to the `node`
 * user with no capabilities (sandbox step S3). Nothing the agent runs later
 * can change these rules. Any failure here stops the container instead of
 * starting it open.
 *
 * Outbound traffic allowed:
 *   - loopback, and replies on connections the gate opened to the web UI;
 *   - host.docker.internal on GATE_ALLOW_HOST_PORTS only (the DocShield
 *     service and the model proxy);
 *   - with GATE_INTERNET=1: DNS and public internet addresses.
 * Everything else is dropped: other host ports (gate, 9Router, embedding…),
 * other containers, the LAN and, by default, the internet. IPv6 is disabled
 * by the gate (`--sysctl net.ipv6.conf.all.disable_ipv6=1`).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '100.64.0.0/10', '127.0.0.0/8', '0.0.0.0/8', '224.0.0.0/4', '240.0.0.0/4']

function fail(message) {
  console.error(`firewall: ${message}; refusing to start`)
  process.exit(3)
}

if (process.getuid?.() !== 0) fail('must start as root to set up the network rules')

// The gate adds host.docker.internal to /etc/hosts (--add-host …:host-gateway), so no DNS is needed to find it.
const hostIp = /^(\d+\.\d+\.\d+\.\d+)\s+.*\bhost\.docker\.internal\b/m.exec(readFileSync('/etc/hosts', 'utf8'))?.[1]
if (hostIp === undefined) fail('host.docker.internal is not in /etc/hosts')
const ports = (process.env.GATE_ALLOW_HOST_PORTS ?? '').split(',').filter(p => /^\d{1,5}$/.test(p))
if (ports.length === 0) fail('GATE_ALLOW_HOST_PORTS is empty')
const internet = process.env.GATE_INTERNET === '1'

const rules = [
  ['-F', 'OUTPUT'],
  ['-A', 'OUTPUT', '-o', 'lo', '-j', 'ACCEPT'],
  ['-A', 'OUTPUT', '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'ACCEPT'],
  ...ports.map(port => ['-A', 'OUTPUT', '-d', hostIp, '-p', 'tcp', '--dport', port, '-j', 'ACCEPT']),
]
if (internet) {
  const nameservers = [...readFileSync('/etc/resolv.conf', 'utf8').matchAll(/^nameserver\s+(\d+\.\d+\.\d+\.\d+)/gm)].map(m => m[1])
  for (const ns of nameservers) for (const proto of ['udp', 'tcp']) rules.push(['-A', 'OUTPUT', '-d', ns, '-p', proto, '--dport', '53', '-j', 'ACCEPT'])
  for (const range of PRIVATE) rules.push(['-A', 'OUTPUT', '-d', range, '-j', 'DROP'])
  rules.push(['-A', 'OUTPUT', '-j', 'ACCEPT'])
}
rules.push(['-P', 'OUTPUT', 'DROP'])

try {
  for (const rule of rules) execFileSync('iptables', ['-w', ...rule], { stdio: ['ignore', 'ignore', 'pipe'] })
} catch (error) {
  fail(`iptables failed (${String(error.stderr ?? error.message).trim()})`)
}
console.log(`firewall: outbound limited to host.docker.internal (${hostIp}) ports ${ports.join(', ')}${internet ? ' + public internet' : ''}`)
