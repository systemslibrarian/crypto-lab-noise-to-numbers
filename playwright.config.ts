import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the PRODUCTION BUILD served by `vite preview`, so what
 * passes here is what ships.
 *
 * Port 4674 is unique to this lab in committed state across the 223-repo
 * fleet — verified by grepping every sibling's `playwright.config.ts` for both
 * `localhost:<port>` and a `PORT =` constant, because the second form is how
 * `blind-hello`'s 4608 hides from the first. Never the Vite default 4173: with
 * this many labs side by side, a shared port means `reuseExistingServer`
 * silently scans a DIFFERENT lab's preview.
 */
const PORT = 4674;
const BASE = `http://localhost:${PORT}/crypto-lab-noise-to-numbers/`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The mutation-ledger reporter runs alongside the usual one. It fails the
  // run when an entry in `e2e/mutations.ts` claims a check that never actually
  // executed -- see `e2e/global-teardown.ts` and SS4.1c.
  reporter: process.env.CI
    ? [['list'], ['./e2e/global-teardown.ts']]
    : [['list'], ['html', { open: 'never' }], ['./e2e/global-teardown.ts']],
  use: {
    baseURL: BASE,
  },
  projects: [
    {
      name: 'a11y',
      testMatch: /a11y\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
    {
      name: 'claims',
      testMatch: /claims\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
  ],
  webServer: {
    // Build before serving. `vite preview` only serves whatever is already in
    // dist/, so without the build in front a run tests a stale bundle — and a
    // build that FAILS leaves the previous good bundle in place, so the whole
    // suite passes green against source that no longer compiles. That silently
    // invalidates mutation checking, which is the only way we prove a test has
    // teeth. With the build in front, a compile error aborts the run instead.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
