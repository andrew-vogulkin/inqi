# Production backend image. Build context = repo root (monorepo: needs the
# workspace manifest + @inqi/shared). Used by .github/workflows/release.yml.
#   docker build -f docker/backend.Dockerfile -t inqi-backend .
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @inqi/shared build \
 && pnpm --filter @inqi/backend exec prisma generate \
 && pnpm --filter @inqi/backend build

FROM node:22-slim
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
# Bring the built workspace over (dist + node_modules + prisma schema/seed).
COPY --from=build /app /app
# The depth agent's open_url tool drives a headless Chromium via Playwright.
# node:22-slim ships none of the browser or its shared-lib deps, so install
# both here (cached under /root/.cache/ms-playwright, used at runtime as root).
RUN pnpm --filter @inqi/backend exec playwright install --with-deps chromium
EXPOSE 4000
CMD ["node", "backend/dist/main.js"]
