# syntax=docker/dockerfile:1
# Multi-stage build for apps/api (spec 002 § 5 "Dockerfiles").
# No secret appears in any ARG, ENV or layer; runtime config arrives as env vars.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# ── prune ────────────────────────────────────────────────────────────────────
# Reduces the build context to `api` and the workspace packages it actually
# depends on, so an unrelated package's change does not invalidate this cache.
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2 prune api --docker

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
# argon2 is a native module with no musl prebuild, so it is compiled here and
# never in the runtime image.
RUN apk add --no-cache python3 make g++
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# ── build ────────────────────────────────────────────────────────────────────
# `prisma generate` runs before `pnpm deploy`, so the generated client travels
# inside the @prisma/client package that deploy then copies. `pnpm prune --prod`
# is not enough here: it leaves the workspace root's devDependencies (turbo,
# mermaid, the Prisma CLI) in the store the runtime image would inherit.
#
# @prisma/client declares `prisma` and `typescript` as peerDependencies, so a
# --prod deploy still resolves the CLI, its engines and `effect` into the tree.
# None of them is reachable at runtime — the query engine ships inside the
# generated client — so they are removed and `/health` proves the result boots.
FROM deps AS build
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter @typing-game/contracts build \
    && pnpm --filter api exec prisma generate \
    && pnpm --filter api build \
    && pnpm --filter api --prod deploy /app/deploy \
    && pnpm --filter api exec prisma generate --schema /app/deploy/prisma/schema.prisma \
    && rm -rf /app/deploy/node_modules/.pnpm/typescript@* \
              /app/deploy/node_modules/.pnpm/prisma@* \
              /app/deploy/node_modules/.pnpm/@prisma+engines@* \
              /app/deploy/node_modules/.pnpm/effect@*

# ── runner ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# A self-contained tree: production dependencies only, no symlink out to a
# workspace store the runtime image does not carry.
COPY --from=build --chown=node:node /app/deploy/node_modules ./node_modules
COPY --from=build --chown=node:node /app/deploy/dist ./dist
COPY --from=build --chown=node:node /app/deploy/prisma ./prisma
COPY --from=build --chown=node:node /app/deploy/package.json ./package.json

USER node
EXPOSE 3001

# Migrations are NOT run here: two replicas starting together would race for
# Prisma's advisory lock. `migrate deploy` is a separate pipeline step (§ 5).
CMD ["node", "dist/main.js"]
