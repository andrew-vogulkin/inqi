FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY . .
# @inqi/shared resolves from its dist/ (dockerignored), so Vite/esbuild can't
# find it until it's compiled. Build it before starting the dev server.
RUN pnpm install --frozen-lockfile=false && pnpm --filter @inqi/shared build
EXPOSE 5173
CMD ["pnpm", "--filter", "@inqi/frontend", "dev", "--host"]
