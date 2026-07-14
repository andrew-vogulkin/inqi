FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY . .
# Build the full chain: deps → @inqi/shared (its types live in dist/, which is
# dockerignored, so it must be compiled in-image) → prisma client (schema-first;
# the @prisma/client postinstall can't locate backend/prisma/schema.prisma) →
# backend. `nest build` alone resolves neither, so build them explicitly here.
RUN pnpm install --frozen-lockfile=false \
 && pnpm --filter @inqi/shared build \
 && pnpm --filter @inqi/backend exec prisma generate \
 && pnpm --filter @inqi/backend build
EXPOSE 4000
CMD ["node", "backend/dist/main.js"]
