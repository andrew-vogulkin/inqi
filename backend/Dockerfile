FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm --filter @inqi/backend build
EXPOSE 4000
CMD ["node", "backend/dist/main.js"]
