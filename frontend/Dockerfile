FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile=false
EXPOSE 5173
CMD ["pnpm", "--filter", "@inqi/frontend", "dev", "--host"]
