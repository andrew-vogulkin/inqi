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
EXPOSE 4000
CMD ["node", "backend/dist/main.js"]
