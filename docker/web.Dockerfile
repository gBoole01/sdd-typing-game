# syntax=docker/dockerfile:1
# Multi-stage build for apps/web (spec 002 § 5 "Dockerfiles").
# Only build-time-public values may be ARGs; no secret in any layer.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# ── prune ────────────────────────────────────────────────────────────────────
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2 prune web --docker

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# ── build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY --from=pruner /app/out/full/ .

# Baked into the client bundle at build time, so it must be public by definition.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @typing-game/contracts build \
    && pnpm --filter web build

# ── runner ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# `output: "standalone"` traces the modules the server actually imports, so the
# runtime image carries no node_modules tree of its own.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
