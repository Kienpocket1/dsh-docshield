import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['tests/global-setup.ts'],
    // gate/ has its own node:test suite (cd gate && npm test).
    include: ['tests/**/*.spec.ts'],
  },
})
