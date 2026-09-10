# typing-game

A typing-speed application: type a generated passage against a timer, and the app records WPM, raw
WPM, accuracy, consistency and a keystroke timeline, then persists results into personal bests and
leaderboards.

This repository is built **spec-first**. Read [`spec/README.md`](spec/README.md) before contributing:
a feature's specification is written and reviewed before its code exists, and tests derived from the
spec are approved before any implementation is written.

| | |
| --- | --- |
| Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Specs | [spec/features/](spec/features/) |
| Agent contract | [CLAUDE.md](CLAUDE.md) |
| Changes | [CHANGELOG.md](CHANGELOG.md) |

## Requirements

- Node 22+
- pnpm 9 (via `corepack enable` — the version is pinned in `package.json`)
- Docker, with either Docker Desktop or Colima running

## Getting started

```bash
cp .env.example .env
pnpm install
pnpm db:up          # Postgres + Mailpit, blocks until healthy
pnpm db:migrate     # apply migrations
pnpm db:seed        # idempotent development data
pnpm dev            # api on :3001, web on :3000
```

`pnpm db:up` waits on the container healthcheck, so the migrate step immediately after it cannot
race Postgres' startup.

### Seeded development account

`pnpm db:seed` creates one known user, documented here because it is the account you log in with
locally:

| Email | Password |
| --- | --- |
| `dev@typing-game.local` | `devpassword123` |

The seed is idempotent — running it twice does not duplicate rows — and refuses to run when
`NODE_ENV=production`.

### Mail in development

Password-reset mail is captured by [Mailpit](https://mailpit.axllent.org/), never sent:

- SMTP on `localhost:1025`
- Web UI on <http://localhost:8025> (`pnpm mail:open`)

Mailpit holds messages in memory only, so a restart discards them. Reset links already issued stay
valid until they expire.

## Commands

| Command | Does |
| --- | --- |
| `pnpm dev` | Both apps via Turborepo — api `:3001`, web `:3000` |
| `pnpm build` | Build every workspace package |
| `pnpm test` | Unit tests |
| `pnpm test:e2e` | Starts the throwaway test database on `:5433`, then the Jest suite |
| `pnpm db:up` / `pnpm db:down` | Start / stop infrastructure (the volume survives `db:down`) |
| `pnpm db:nuke` | Destroy the data volume. Prompts for confirmation |
| `pnpm db:migrate` | `prisma migrate dev` — development only. `pnpm db:migrate --name add_results` |
| `pnpm db:deploy` | `prisma migrate deploy` — CI and production only |
| `pnpm db:seed` | Idempotent seed |
| `pnpm db:reset` | Drop, re-migrate and re-seed |
| `pnpm db:studio` | Prisma Studio |
| `pnpm db:dump` / `pnpm db:restore <file>` | Local backup to `.backups/`, and restore |
| `pnpm mail:open` | Open the Mailpit UI |
| `pnpm typecheck` | Typecheck every workspace package |
| `pnpm docs:diagrams` | Parse every Mermaid block in the repository |

Migrations are never run from a container `CMD`: two replicas starting together would race for
Prisma's advisory lock, so `migrate deploy` is a separate deployment step.

## Layout

```
apps/api        NestJS 11 — HTTP API, business logic, persistence
apps/web        Next.js 16 — App Router, acts as the BFF
packages/contracts    zod schemas + inferred types shared by both apps
packages/tsconfig     shared TypeScript base config
docker/         compose file and the two multi-stage Dockerfiles
scripts/        database maintenance and the diagram checker
spec/           the specifications this code implements
```

## Testing

| Layer | Tool |
| --- | --- |
| API unit | Jest |
| API e2e | Jest + Supertest against a real Postgres on `:5433` (tmpfs, wiped per run) |
| Web | Vitest + React Testing Library |

The e2e database is separate from development's on purpose: running the suite while `pnpm dev` is
live never touches your development data. Tables are truncated between test files rather than
rolled back per test, so code that opens its own transaction behaves normally.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `bind: address already in use` on 5432 | Another Postgres is running. Set `POSTGRES_PORT` in `.env` |
| Port 1025 or 8025 in use | Stop the conflicting mail catcher, or override the published ports |
| Postgres refuses to start after an upgrade | The volume holds an older major version's data: `pnpm db:nuke` (destroys data) or a manual `pg_upgrade` |
| `P1001` from Prisma | The database is not up. `pnpm db:up` |
| The API refuses to boot listing variables | `.env` is missing or incomplete: `cp .env.example .env` |
