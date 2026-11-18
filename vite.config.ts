/**
 * vite.config.ts: configuration for the dev server, the production build and Vitest.
 *
 * Vite serves the source as native ES modules during development and bundles it with
 * code splitting for production. Vitest reuses this same file, so the tests resolve
 * imports exactly like the game does.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs, so `dist/` works from any sub-folder (for example GitHub Pages).
  base: './',
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Three.js alone is roughly 700 kB minified. That is expected for a 3D game,
    // so raise the warning threshold instead of hiding a real problem elsewhere.
    chunkSizeWarningLimit: 1000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The headless CPU vs CPU match simulates thousands of ticks.
    testTimeout: 120_000,
  },
});
