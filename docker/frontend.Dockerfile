# Production frontend image: build the Vite SPA, serve the static bundle via nginx.
# Build context = repo root (monorepo: needs the workspace manifest + @inqi/shared).
#   docker build -f docker/frontend.Dockerfile -t inqi-frontend .
# Build-time Google client id (public; baked into the bundle):
#   docker build -f docker/frontend.Dockerfile --build-arg VITE_GOOGLE_CLIENT_ID=... -t inqi-frontend .
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @inqi/shared build \
 && pnpm --filter @inqi/frontend build

FROM nginx:1.27-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
