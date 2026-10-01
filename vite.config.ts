import { defineConfig, configDefaults } from 'vitest/config';

// base must match the GitHub Pages project subpath:
// https://systemslibrarian.github.io/crypto-lab-noise-to-numbers/
export default defineConfig({
  base: '/crypto-lab-noise-to-numbers/',
  worker: {
    // The descriptive-statistics worker ships as an ES module so it can
    // `import` the same analysis code the unit tests exercise. Without this
    // Vite emits an IIFE worker and the shared imports are duplicated.
    format: 'es',
  },
  test: {
    // Colocated unit tests only; keep Playwright specs in e2e/ out of the Vitest run.
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
