/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

// base './' so the same bundle works from Capacitor's file:// webview later.
export default defineConfig({
  base: './',
  build: { target: 'es2020' },
  server: { host: true, port: 5173 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
