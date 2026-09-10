# 002 — Database & Docker

| | |
| --- | --- |
| **Spec** | 002 |
| **Status** | Draft — decisions resolved 2026-09-10, awaiting approval to implement |
| **Owner** | Nicolas |
| **Last updated** | 2026-09-10 |
| **Depends on** | — (this is the foundation spec) |

## 1. Summary

The persistence and local-development foundation: PostgreSQL 17 in Docker Compose, the Prisma
connection and migration workflow across development / CI / production, seed data, the environment
variable contract with fail-fast validation, and multi-stage production images for both apps, and the local mail catcher that
[spec 001](001-authentication-and-users.md#mail-port)'s password reset depends on. Every
other spec depends on this one, so it is deliberately concrete: exact ports, exact file paths,
exact commands.

## 2. Scope

**In scope**

- `docker/docker-compose.yml` — Postgres 17, healthcheck, named volume, Compose profiles.
- A separate throwaway test database for the e2e suite.
- Prisma client lifecycle inside NestJS (`PrismaModule` / `PrismaService`).
- Connection pooling and timeout policy.
- Migration workflow: create, apply, CI drift detection, production deploy.
- Seed script and the data it produces.
- Env-var contract, `.env.example`, boot-time zod validation.
- Multi-stage `api.Dockerfile` and `web.Dockerfile`.
- Local mail capture (Mailpit) so the password-reset flow works from a clean clone.
- Backup / restore for local development.

**Out of scope**

- Production hosting topology, managed-Postgres selection, and the CD pipeline → future spec 00X.
- Read replicas, sharding, PgBouncer.
- Redis. **Decided against for v1** ([§ 10](#10-decision-log), Q5): one API instance, so
  `@nestjs/throttler`'s memory store is sufficient. This makes every rate limit in spec 001
  per-instance, which is recorded there as a known limitation.
- Production mail provider setup (sending domain, DKIM/SPF). The local driver is in scope; the
  provider choice is tracked in [spec 001 § 11](001-authentication-and-users.md#11-open-questions).
- Observability stack (Prometheus/Grafana/OTel collector).
- Domain schemas beyond the two tables needed to prove migrations work; each domain's schema lives
  in its own feature spec.

## 3. User stories

### US-1 — One-command local environment

*As a developer cloning the repo I want the environment running with one command so that onboarding
takes minutes, not an afternoon.*

1. `cp .env.example .env && pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev` produces a
   working app against a seeded database.
2. `pnpm db:up` blocks until Postgres reports healthy, so the immediately-following migrate command
   cannot race the container's startup.
3. No step requires a globally installed `psql`, `postgres` or `prisma`.
4. The stack runs with zero secrets configured beyond the placeholders in `.env.example`.

### US-2 — Fail fast on misconfiguration

*As a developer I want the app to refuse to boot on bad configuration so that I never debug a
runtime `undefined` that was really a missing env var.*

1. A missing required env var aborts boot with a message naming every offending variable at once,
   not one per restart.
2. A malformed `DATABASE_URL` aborts boot with the parse error.
3. `JWT_ACCESS_SECRET` shorter than 32 characters aborts boot.
4. In production, a `DATABASE_URL` pointing at `localhost` logs a `warn` (it is legal in Docker
   networking but usually a mistake).

### US-3 — Safe, reviewable migrations

*As a developer changing the schema I want migrations to be explicit files under review so that
schema changes go through the same scrutiny as code.*

1. `pnpm db:migrate --name add_results` produces a timestamped SQL file under
   `apps/api/prisma/migrations/` and applies it.
2. CI fails when `schema.prisma` and the migration folder disagree (drift).
3. CI fails when a migration is not deterministically applicable to an empty database.
4. Production deploys run `prisma migrate deploy` only — never `migrate dev`, never `db push`.
5. A destructive migration (dropped column or table) must be flagged in the PR description; CI
   detects the pattern and labels the PR `destructive-migration`.

### US-4 — Isolated, fast tests

*As a developer running the e2e suite I want a database that is disposable so that tests never
depend on, or corrupt, my development data.*

1. The test database runs on port `5433`, distinct from development's `5432`.
2. It uses `tmpfs` storage — no volume, nothing survives a restart, and writes are RAM-speed.
3. The suite migrates once, then truncates all tables between test files.
4. Running the suite while `pnpm dev` is live does not touch the development database.

### US-5 — Realistic seed data

*As a developer working on the leaderboard or history UI I want seeded data so that I can build
against realistic content instead of an empty state.*

1. Seeding is idempotent — running it twice does not duplicate rows.
2. It creates a known test user (`dev@typing-game.local` / `devpassword123`) documented in the
   README.
3. It creates enough results with varied WPM to exercise pagination and leaderboard ranking.
4. The seed script refuses to run when `NODE_ENV === "production"`.

## 4. Data model

This spec owns only the infrastructure-level schema concerns. Domain models live in their own specs
(users/sessions in [spec 001](001-authentication-and-users.md#4-data-model), results in spec 003).

```prisma
// apps/api/prisma/schema.prisma

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["relationJoins"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### Conventions enforced by review

| Concern | Rule |
| --- | --- |
| Primary keys | `String @id @default(cuid(2))` |
| Timestamps | `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`, `timestamptz` |
| Deletes | Explicit `onDelete:` on every relation. There is no default; ambiguity here silently orphans or cascades |
| Money / decimals | `Decimal` — never `Float`. (No monetary fields in v1, but the rule pre-empts it) |
| Metrics | WPM and accuracy stored as `Decimal(6,2)` / `Decimal(5,4)`. Float rounding must not make two identical performances rank differently |
| Enums | Postgres enums via Prisma `enum`, `SCREAMING_SNAKE_CASE` values |
| Naming | Prisma models `PascalCase` singular; `@@map` only if a table name must differ |
| Indexes | Every foreign key used in a filter gets an index, with the reason in a comment |
| Nullability | Columns are `NOT NULL` unless the spec states why the absence is meaningful |

### Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- username search on the leaderboard
CREATE EXTENSION IF NOT EXISTS "citext";    -- reserved; email is lowercased in app code instead
```

Enabled in the initial migration. `citext` is created but unused: the email-lowercasing rule lives
in application code (spec 001) so behaviour is testable without a database round-trip.

## 5. Interface contracts

No HTTP endpoints, apart from one liveness probe. The contract here is the command surface and the
env schema.

### `docker/docker-compose.yml`

```yaml
name: typing-game

services:
  postgres:
    image: postgres:17-alpine
    container_name: tg-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-typing}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-typing}
      POSTGRES_DB: ${POSTGRES_DB:-typing_game}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - tg-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-typing} -d ${POSTGRES_DB:-typing_game}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  postgres-test:
    image: postgres:17-alpine
    container_name: tg-postgres-test
    profiles: ["test"]
    environment:
      POSTGRES_USER: typing
      POSTGRES_PASSWORD: typing
      POSTGRES_DB: typing_game_test
      PGDATA: /var/lib/postgresql/data
    ports:
      - "5433:5432"
    tmpfs:
      - /var/lib/postgresql/data
    command: >
      postgres -c fsync=off -c full_page_writes=off -c synchronous_commit=off
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U typing -d typing_game_test"]
      interval: 2s
      timeout: 3s
      retries: 15

  mailpit:
    image: axllent/mailpit:latest
    container_name: tg-mailpit
    restart: unless-stopped
    ports:
      - "1025:1025"   # SMTP, consumed by MAIL_DRIVER=smtp
      - "8025:8025"   # web UI — open this to read reset mails
    environment:
      MP_MAX_MESSAGES: 500
      MP_SMTP_AUTH_ACCEPT_ANY: 1
      MP_SMTP_AUTH_ALLOW_INSECURE: 1

  adminer:
    image: adminer:5
    profiles: ["tools"]
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy

  api:
    build:
      context: ..
      dockerfile: docker/api.Dockerfile
    profiles: ["full"]
    env_file: [../.env]
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-typing}:${POSTGRES_PASSWORD:-typing}@postgres:5432/${POSTGRES_DB:-typing_game}?schema=public
    ports:
      - "3001:3001"
    depends_on:
      postgres:
        condition: service_healthy

  web:
    build:
      context: ..
      dockerfile: docker/web.Dockerfile
    profiles: ["full"]
    env_file: [../.env]
    environment:
      API_BASE_URL: http://api:3001/api/v1
    ports:
      - "3000:3000"
    depends_on: [api]

volumes:
  tg-pgdata:
```

Notes on the choices:

- `fsync=off` on the test database only. It roughly halves suite time and the data is disposable by
  definition; using it on the development database would risk real corruption on a hard shutdown.
- `depends_on: condition: service_healthy` rather than a wait-for-it script — Compose already knows
  how to wait, and the healthcheck is the same signal `pnpm db:up` blocks on.
- `mailpit` is in the **default** profile, not `tools`: password reset is a core flow, and a clean
  clone must be able to exercise it with one command. It holds mail in memory only.
- `api` and `web` are profile-gated so the everyday `docker compose up` starts Postgres and Mailpit
  alone.

### Command surface (root `package.json`)

| Script | Runs | Notes |
| --- | --- | --- |
| `db:up` | `docker compose -f docker/docker-compose.yml up -d --wait postgres mailpit` | `--wait` blocks on the healthcheck (US-1.2) |
| `mail:open` | `open http://localhost:8025` | Read captured reset mails |
| `docs:diagrams` | Extracts every fenced Mermaid block and runs `mermaid.parse()` | Enforced in CI on any PR touching a `.md` file ([spec/README.md § Diagrams](../README.md#diagrams)) |
| `db:down` | `… down` | Keeps the volume |
| `db:nuke` | `… down -v` | Destroys data. Prompts for confirmation |
| `db:migrate` | `pnpm --filter api prisma migrate dev` | Development only |
| `db:deploy` | `pnpm --filter api prisma migrate deploy` | CI/production |
| `db:seed` | `pnpm --filter api prisma db seed` | Idempotent |
| `db:studio` | `pnpm --filter api prisma studio` | |
| `db:reset` | `… migrate reset --force && pnpm db:seed` | Development only |
| `test:e2e` | `docker compose … --profile test up -d --wait postgres-test && pnpm --filter api test:e2e` | |
| `dev` | `turbo run dev` | api on 3001, web on 3000 |

### Migration lifecycle

```mermaid
flowchart TD
    E["edit apps/api/prisma/schema.prisma"] --> MD["pnpm db:migrate<br/>prisma migrate dev --name x"]
    MD --> SQL["timestamped SQL committed under<br/>prisma/migrations/"]
    SQL --> PR["pull request"]
    PR --> FRESH["CI: migrate deploy against an empty database"]
    FRESH --> DRIFT{"CI: migrate diff --exit-code<br/>schema and migrations agree?"}
    DRIFT -->|"no, drift"| FAIL["CI fails"]
    DRIFT -->|"yes"| DESTR{"contains DROP COLUMN<br/>or DROP TABLE?"}
    DESTR -->|"yes"| LABEL["label PR destructive-migration<br/>and require it in the description"]
    DESTR -->|"no"| PASS["CI passes"]
    LABEL --> PASS
    PASS --> STEP["deploy pipeline step:<br/>prisma migrate deploy"]
    STEP --> BOOT["containers start"]
```

`migrate deploy` is a pipeline step, never a container `CMD`: two replicas booting together would
race, and Prisma's advisory lock would turn a deploy into a coin flip over which replica waits.

### Environment contract

`.env.example` (committed; `.env` and `.env.local` are gitignored and never read by an agent):

```dotenv
# ── Postgres (consumed by docker-compose) ─────────────────────────────
POSTGRES_USER=typing
POSTGRES_PASSWORD=typing
POSTGRES_DB=typing_game
POSTGRES_PORT=5432

# ── API (apps/api) ────────────────────────────────────────────────────
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://typing:typing@localhost:5432/typing_game?schema=public&connection_limit=10&pool_timeout=10
JWT_ACCESS_SECRET=replace-me-with-32-plus-random-bytes-abcdef
JWT_ACCESS_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30
REFRESH_GRACE_SECONDS=10
IP_HASH_PEPPER=replace-me-too-abcdefabcdefabcdefabcdef
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=debug
COOKIE_DOMAIN=localhost

# ── Mail (password reset — spec 001) ───────────────────────────
MAIL_DRIVER=smtp                      # smtp | resend | memory
MAIL_FROM="Typing Game <no-reply@typing-game.local>"
SMTP_URL=smtp://localhost:1025        # Mailpit; no credentials locally
RESEND_API_KEY=                       # required only when MAIL_DRIVER=resend
PASSWORD_RESET_TTL_MINUTES=30

# ── Web (apps/web) ────────────────────────────────────────────────────
API_BASE_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Boot-time validation, `apps/api/src/config/env.schema.ts`:

| Variable | Rule | Required |
| --- | --- | --- |
| `NODE_ENV` | `"development" \| "test" \| "production"` | yes |
| `PORT` | integer 1–65535, default `3001` | no |
| `DATABASE_URL` | valid URL, protocol `postgresql:` | yes |
| `JWT_ACCESS_SECRET` | string ≥ 32 chars | yes |
| `JWT_ACCESS_TTL` | duration string, default `15m` | no |
| `REFRESH_TOKEN_TTL_DAYS` | integer 1–365, default `30` | no |
| `REFRESH_GRACE_SECONDS` | integer 0–60, default `10` | no |
| `IP_HASH_PEPPER` | string ≥ 16 chars | yes |
| `CORS_ORIGIN` | comma-separated origins | yes |
| `LOG_LEVEL` | pino level, default `info` | no |
| `COOKIE_DOMAIN` | hostname | yes |
| `MAIL_DRIVER` | `"smtp" \| "resend" \| "memory"`, default `smtp` | no |
| `MAIL_FROM` | RFC-5322 address or `Name <addr>` | yes |
| `SMTP_URL` | valid `smtp:`/`smtps:` URL — **required when** `MAIL_DRIVER=smtp` | conditional |
| `RESEND_API_KEY` | non-empty — **required when** `MAIL_DRIVER=resend` | conditional |
| `PASSWORD_RESET_TTL_MINUTES` | integer 5–1440, default `30` | no |

The two conditional rows use a zod `superRefine`, so choosing a driver without its credential fails
at boot rather than at the first password-reset attempt — which is exactly the kind of failure that
otherwise surfaces only in production, from a user who cannot log in to report it.

Only `NEXT_PUBLIC_*` variables are exposed to the browser bundle. A non-prefixed variable
referenced in a Client Component is an ESLint error — that mistake ships secrets to the client, so
it must fail at lint time rather than review time.

### `PrismaService` contract

- Extends `PrismaClient`, implements `OnModuleInit` (connect) and `OnModuleDestroy` (disconnect).
- Exposes `truncateAll()`, which throws unless `NODE_ENV === "test"` — used by the e2e harness
  between files.
- Log levels bridged into pino; `query` logging only at `LOG_LEVEL=debug`.
- `PrismaModule` is `@Global()`. It is the one legitimate global module: every domain module needs
  it, and re-importing it everywhere is noise without benefit.

### Pooling & timeouts

| Setting | Value | Reason |
| --- | --- | --- |
| `connection_limit` | 10 per API instance in development | Postgres default `max_connections` is 100; leaves room for Studio, psql and the test DB |
| `pool_timeout` | 10 s | Fail fast rather than queue requests behind an exhausted pool |
| `statement_timeout` | 10 s (session-level) | A runaway leaderboard query must not pin a connection indefinitely |
| Transaction `maxWait` / `timeout` | 5 s / 10 s | Applies to `$transaction` calls |

**Deployment target confirmed as a long-lived container** ([§ 10](#10-decision-log), Q2), so these
settings stand as written. A serverless target would need PgBouncer or Prisma Accelerate, since
per-invocation connections exhaust the pool; moving to one requires amending this section first.

### Liveness / readiness

`GET /api/v1/health` (public, unauthenticated):

```json
{ "status": "ok", "database": "up", "uptime": 1284.4, "version": "0.1.0" }
```

`200` when the database answers `SELECT 1` within 2 s, `503` with
`{ "error": { "code": "SERVICE_UNAVAILABLE", … } }` otherwise. The check does not touch application
tables — a liveness probe must not depend on the schema being migrated.

### Dockerfiles

`docker/api.Dockerfile`, four stages:

| Stage | Does |
| --- | --- |
| `base` | `node:22-alpine`, `corepack enable`, non-root `node` user |
| `deps` | `turbo prune --scope=api --docker`, then `pnpm install --frozen-lockfile` against the pruned lockfile |
| `build` | `prisma generate`, `nest build`, then `pnpm prune --prod` |
| `runner` | Copies `dist/`, pruned `node_modules`, `prisma/`. `USER node`. `CMD ["node", "dist/main.js"]` |

`docker/web.Dockerfile` mirrors it, using Next.js `output: "standalone"` and copying
`.next/standalone` plus `.next/static`.

Hard rules:

- No secret in any `ARG`, `ENV` or layer. Only build-time-public values
  (`NEXT_PUBLIC_APP_URL`) may be `ARG`s.
- Both final images run as non-root.
- `.dockerignore` excludes `node_modules`, `.next`, `dist`, `.env*`, `.git`.
- Migrations are **not** run from the image `CMD`. Two replicas starting at once would race;
  `migrate deploy` is a separate pipeline step.

## 6. Frontend pages & routes

Not applicable — this feature has no UI surface. The section is retained so section numbering stays
identical across specs and cross-references remain predictable
([spec/README.md § required sections](../README.md#required-sections)).

The only user-visible artefact is the Mailpit UI at `http://localhost:8025`, a development tool
rather than part of the product.

## 7. Edge cases & error handling

| Condition | Expected behaviour |
| --- | --- |
| Port 5432 already in use (another Postgres on the host) | Compose fails with a clear bind error. `POSTGRES_PORT` overrides it without editing the compose file |
| `pnpm db:migrate` run before Postgres is healthy | Cannot happen via the scripts (`--wait`); run directly, Prisma emits `P1001` and the script exits non-zero |
| Container up but the volume holds an older major version's data | Postgres refuses to start with a version-mismatch error. Documented remedy: `pnpm db:nuke` (data loss) or a manual `pg_upgrade` |
| API starts while the database is down | Boot fails loudly and non-zero. No silent retry loop — an API that "runs" without persistence is worse than one that is visibly down |
| Database drops mid-request | Prisma throws `P1001`; the global filter maps it to 503 `SERVICE_UNAVAILABLE`. The `/health` endpoint reports `database: "down"` |
| Migration fails halfway | Prisma marks it failed and refuses further migrations until resolved via `migrate resolve`. Never `db push` over a failed migration |
| Two API replicas both run `migrate deploy` | Prisma takes an advisory lock; the loser waits then no-ops. Still not run from `CMD` (see above) |
| Unique-constraint violation from a race | `P2002` → 409 with the domain-appropriate `code`. The raw Prisma code never reaches the client |
| Connection pool exhausted | `P2024` after `pool_timeout` → 503 `SERVICE_UNAVAILABLE`, logged at `error` with the pool metrics |
| `truncateAll()` called with `NODE_ENV=development` | Throws immediately. This guard is the only thing between a typo and a wiped development database |
| Seed run twice | Idempotent via `upsert` on natural keys |
| Seed run with `NODE_ENV=production` | Exits 1 before opening a connection |
| `.env` missing entirely | Boot fails listing every required variable, with the `cp .env.example .env` hint |
| Test suite run without the `test` profile up | `test:e2e` starts it with `--wait`; run directly, Prisma fails with `P1001` |
| Docker not running | Scripts surface Docker's own error; the README documents Colima and Docker Desktop as the two supported runtimes |
| Port 1025 or 8025 already in use | Compose fails with a bind error. Documented remedy: stop the conflicting mail catcher, or override the published ports |
| `MAIL_DRIVER=smtp` with Mailpit down | The send throws, the auth service catches it, `/auth/forgot-password` still returns 202 and logs at `error` (spec 001 US-6.9). Development is not blocked by a missing mail catcher |
| `MAIL_DRIVER=resend` with an empty `RESEND_API_KEY` | Boot fails naming the variable (conditional env rule above) |
| Mailpit restarted mid-development | Previously captured mails are gone — it is memory-only by design. Reset links already sent remain valid until they expire |
| A test opens its own transaction while the harness truncates | Cannot happen: truncation runs between test files, never concurrently with a test (§ 10 Q4) |
| `TRUNCATE` blocked by a foreign key | The harness truncates all tables in one statement with `CASCADE`, so ordering is irrelevant |
| Timezone differences between host and container | Irrelevant by construction: `timestamptz` everywhere and the container is UTC. Asserted by a test that writes and reads a timestamp across the boundary |

## 8. Non-functional requirements

| Requirement | Target |
| --- | --- |
| Cold `pnpm db:up` to healthy | ≤ 10 s on Apple Silicon |
| Full e2e suite (test profile) | ≤ 90 s |
| API image size | ≤ 250 MB |
| Web image size | ≤ 200 MB |
| Postgres version | 17.x, pinned to the minor via digest in CI |
| Mailpit | Memory-only, capped at 500 messages. Never present in a production compose file or image |
| Backups (local) | `pnpm db:dump` writes `./.backups/<ISO8601>.sql.gz`; `pnpm db:restore <file>` restores. `.backups/` gitignored |
| Migration determinism | CI applies every migration to an empty database from scratch on each PR |
| Secret hygiene | `gitleaks` in CI; `.env`, `.env.local`, `.backups/` gitignored. `.env.local` is never opened by an agent |
| Container security | Non-root user, no `--privileged`, no host network, read-only root filesystem where the app allows |

## 9. Test plan

```mermaid
sequenceDiagram
    autonumber
    participant S as pnpm test:e2e
    participant C as compose profile test
    participant P as postgres-test :5433 tmpfs
    participant J as Jest

    S->>C: up -d --wait postgres-test
    C-->>S: healthy
    S->>P: prisma migrate deploy, once per run
    S->>J: run the suites
    loop each test file
        J->>P: TRUNCATE every table CASCADE
        J->>P: insert only the fixtures this file needs
        J->>J: run the file's tests
    end
    J-->>S: results
    S->>C: down, tmpfs discarded
```

Truncation happens *between* files, never concurrently with a running test, so code that opens its
own transaction is unaffected — the reason truncation beat rollback-per-test in
[§ 10](#10-decision-log) Q4.

### Infrastructure — Jest, `apps/api/test/infra.e2e-spec.ts`

| Test | Asserts |
| --- | --- |
| bootstraps against the test database | App module compiles, `PrismaService` connects (US-4.1) |
| `/health` reports up | 200, `database: "up"` |
| `/health` reports down | With the connection severed: 503 `SERVICE_UNAVAILABLE`, `database: "down"` |
| `truncateAll()` guard | Throws when `NODE_ENV !== "test"` |
| `timestamptz` round-trip | A written `DateTime` reads back identical in UTC regardless of host TZ |
| `P2002` mapping | A forced duplicate insert surfaces as 409, never as a Prisma code |
| `P2024` mapping | Pool exhaustion (limit 1, concurrent queries) surfaces as 503 |
| truncation isolation | Rows written by one test file are absent in the next; `truncateAll()` completes in < 100 ms (US-4.3, § 10 Q4) |
| memory mail driver | `MAIL_DRIVER=memory` records sends without network I/O, and the e2e suite never opens an SMTP connection |

### Config — Jest, `apps/api/src/config/env.schema.spec.ts`

| Test | Asserts |
| --- | --- |
| accepts a valid env | Parsed, defaults filled (US-2) |
| rejects a missing `DATABASE_URL` | Error names the variable |
| rejects a non-`postgresql:` URL | Error names the protocol |
| rejects a 31-char `JWT_ACCESS_SECRET` | Rejected; 32 accepted (US-2.3) |
| reports **all** failures at once | Two missing vars → both in one message (US-2.1) |
| coerces `PORT` from a string | `"3001"` → `3001` |

### Migrations & seed — CI job

| Check | Asserts |
| --- | --- |
| `prisma migrate deploy` on an empty database | Exits 0 (US-3.3) |
| `prisma migrate diff --from-migrations --to-schema-datamodel --exit-code` | Exits 0 — no drift (US-3.2) |
| `prisma db seed` twice in a row | Row counts identical after the second run (US-5.1) |
| seed with `NODE_ENV=production` | Exits 1 (US-5.4) |
| destructive-migration detection | A migration containing `DROP COLUMN`/`DROP TABLE` labels the PR (US-3.5) |

### Docker — CI job

| Check | Asserts |
| --- | --- |
| both images build from a clean checkout | Exit 0 |
| final images run as non-root | `docker inspect` user ≠ `root` |
| no secrets in layers | `docker history` contains no value from `.env.example`'s secret fields |
| image size budgets | Within §7 targets |
| `--profile full` end-to-end | `curl` of `/api/v1/health` through the composed stack returns 200 |
| default profile brings up mail capture | `db:up` leaves Mailpit reachable on 1025 and 8025 |
| every Mermaid block parses | `pnpm docs:diagrams` exits 0 across all `.md` files; a deliberately broken block makes it exit non-zero |

## 10. Decision log

| # | Question | Resolution (2026-09-10) |
| --- | --- | --- |
| Q1 | Run `api`/`web` in Compose for development? | **No — infrastructure only.** Postgres and Mailpit run in Compose; both apps run on the host via `pnpm dev`. Bind-mount HMR on macOS is materially slower. The `full` profile stays available for parity checks against the production images |
| Q2 | Serverless or long-lived container? | **Long-lived container** (Fly / Railway / ECS class). The pooling settings in § 5 are final for v1; no PgBouncer or Prisma Accelerate. Moving to serverless later requires amending § 5 before deploying |
| Q3 | Prisma or Drizzle? | **Prisma.** Confirms decision 1 in [ARCHITECTURE.md § 9](../../ARCHITECTURE.md#9-open-decisions-for-review). Every schema block in every spec is now binding |
| Q4 | Truncate or transaction-rollback test isolation? | **Truncate**, between test files, one `TRUNCATE … CASCADE`. Correct in the presence of code that opens its own transactions, which rollback-per-test breaks. Revisit only if the suite exceeds the 90 s budget in § 8 |
| Q5 | Redis for shared rate-limit state? | **No.** One API instance in v1, `@nestjs/throttler` memory store. Consequence: every rate limit in spec 001 is per-instance, recorded there as a known limitation and a blocker for horizontal scaling |

## 11. Open questions

None outstanding for this spec.

Two dependent questions live elsewhere:

- **Production mail provider** (Resend / Postmark / SES) — tracked in
  [spec 001 § 11](001-authentication-and-users.md#11-open-questions) Q1. Only the `MailService`
  driver and the env vars in § 5 change; nothing in this spec is blocked.
- **Production hosting topology and CD pipeline** — deliberately out of scope (§ 2) and its own
  future spec. Q2 above fixes only the *class* of target, which is all the pooling policy needs.
