/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

// base './' so the same bundle works from Capacitor's file:// webview later.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        // Phaser is ~90% of the bundle and changes only when we bump it, while
        // game code changes every build. Splitting them means a rebuild
        // invalidates a ~200 kB chunk instead of a ~1.8 MB one — worth it for
        // the browser build; harmless in the Capacitor webview, which loads
        // both from disk.
        manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined),
      },
    },
    // With phaser split out the remaining chunks are well under the default
    // 500 kB; the engine chunk is legitimately large and is not a warning.
    chunkSizeWarningLimit: 1600,
  },
  server: { host: true, port: 5173 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
