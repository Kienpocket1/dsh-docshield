// Multi-process tests (TC-06) run the compiled dist/ in child processes, so build first.
import { execSync } from 'node:child_process'

export default function setup(): void {
  execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' })
}
