import { defineConfig } from '@playwright/test';

const PORT = 4188;

/** UI-draw e2e (FE convention #5). Boots the Vite dev server; tests need no backend. */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
