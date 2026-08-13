import { defineConfig, devices } from '@playwright/test'

/**
 * E2E playtest config. Runs against the Vite dev server because the dev build
 * exposes `window.__game`, which the test uses to read game state and map hex
 * cells to pixels (all interaction still goes through real pointer events).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    // 127.0.0.1 and a port of our own, NOT localhost:5173. Several games in this
    // folder run Vite on the default port; `localhost` resolves to ::1 first on
    // macOS, and `reuseExistingServer` then happily adopts whichever project got
    // there first — the tests go green or red against somebody else's game.
    baseURL: 'http://127.0.0.1:5273',
    viewport: { width: 900, height: 1400 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5273 --strictPort',
    url: 'http://127.0.0.1:5273',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
