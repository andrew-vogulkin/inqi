/**
 * Load the repo-root `.env` into `process.env` **before** any module reads it
 * (BossService/ConfigService read `process.env.*` directly). Imported first in
 * `main.ts`. From both `dist/` (prod build) and `src/` (ts-jest / nest watch),
 * `../../.env` resolves to the repo root. In production the platform supplies env
 * and there is no file — that case is ignored.
 */
import { resolve } from 'path';

const rootEnv = resolve(__dirname, '../../.env');
try {
  // Node 20.12+ — no dependency. Loads + parses KEY=value (comments/quotes handled).
  (process as NodeJS.Process & { loadEnvFile?: (path: string) => void }).loadEnvFile?.(rootEnv);
} catch {
  // No .env file (prod/CI) — env comes from the platform; nothing to do.
}
