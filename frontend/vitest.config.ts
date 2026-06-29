import { defineConfig } from 'vitest/config';

// Reducer unit tests are pure → node env, no DOM. (Playwright covers UI draw.)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
