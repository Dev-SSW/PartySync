# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
# Production always uses the same-origin API; no secret or developer .env enters the build.
ENV VITE_API_BASE_URL=/api
RUN npm run typecheck && npm run build

FROM caddy:2-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /web/dist/ /srv/
HEALTHCHECK --interval=20s --timeout=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:2015/index.html || exit 1
