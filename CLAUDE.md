# CLAUDE.md

Operating contract for coding agents in this repository. Read this before touching anything.

## What this is

`typing-game` — a typing-speed application. A user types a generated passage against a timer; the
app records WPM, raw WPM, accuracy, consistency and a keystroke timeline, then persists results into
personal bests and leaderboards.

**Current state: specification only.** There is no application code, no `package.json`, no
`node_modules`, no git repository. The five markdown files below are the entire repo. Every command
in § Commands is *specified* in spec 002 but does not exist yet — do not run them, and do not report
their output.

## The one rule that overrides everything

This project is **Spec-Driven Development with TDD and a human approval gate**. For every feature:

| # | Step | Output |
| --- | --- | --- |
| 1 | **Analyze** | Read `spec/features/NNN-*.md` end to end. Raise contradictions before writing anything |
| 2 | **Plan** | Present an implementation strategy: files, order, risks |
| 3 | **Red** | Write failing tests from the spec's § 5 contracts and § 9 test plan. **Tests only** |
| 4 | **🛑 HUMAN GATEWAY** | Stop. Wait for Nicolas to explicitly approve the tests. **Write zero feature code before that approval.** If the tests look wrong, the spec is usually wrong — return to step 1 |
| 5 | **Green** | Minimal clean code that makes the approved tests pass. No extra features, no speculative abstraction |
| 6 | **Changelog** | Entry under `[Unreleased]` in `CHANGELOG.md`; move the spec's status to `Implemented` |

Step 4 is not a formality. Do not batch it with step 5. Do not write "the tests, and also a stub
implementation". Stop and ask.

**No application code before its spec exists and is approved.** If asked to build something with no
spec, write the spec first (per [spec/README.md](spec/README.md)) and get it reviewed.

## Repository map

| Path | What |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Target architecture: monorepo layout, BFF boundary, module layering, state management, Docker, confirmed decisions (§ 9) |
| [CHANGELOG.md](CHANGELOG.md) | Keep a Changelog. Every feature updates `[Unreleased]` at step 6 |
| [spec/README.md](spec/README.md) | Spec conventions: statuses, the 11 required sections, error envelope, pagination, the dev cycle |
| [spec/features/001-authentication-and-users.md](spec/features/001-authentication-and-users.md) | Auth, sessions, password reset, profile, settings, account deletion, **and all their frontend pages** |
| [spec/features/002-database-and-docker.md](spec/features/002-database-and-docker.md) | Postgres, Prisma, migrations, env contract, Dockerfiles, Mailpit |

Planned but not yet created: `apps/api` (NestJS), `apps/web` (Next.js), `packages/contracts`,
`packages/typing-engine`, `docker/`. Layout is fixed in
[ARCHITECTURE.md § 2](ARCHITECTURE.md#2-repository-layout) — follow it exactly rather than inventing
a structure.

## Confirmed decisions — do not re-litigate

All settled 2026-09-10. Reasoning and trade-offs live in
[ARCHITECTURE.md § 9](ARCHITECTURE.md#9-open-decisions-for-review) and each spec's § 10.

| Decision | Answer |
| --- | --- |
| ORM | **Prisma.** `prisma migrate` only — never `db push`, never `migrate dev` in CI or production |
| Validation | **zod in `packages/contracts`** + `nestjs-zod` `createZodDto`. Deliberately overrides the `class-validator` default |
| Monorepo | **pnpm workspaces + Turborepo** |
| Token transport | **httpOnly cookies via the Next.js BFF.** Bearer also supported for future non-browser clients |
| Guest play | **Allowed**, 90-day guest cookie, results claimed on signup |
| Local dev | **Compose runs infrastructure only** (Postgres + Mailpit); apps run on the host via `pnpm dev` |
| Deploy target | **Long-lived container.** Not serverless — the pooling settings assume it |
| Test isolation | **Truncate between test files.** Not transaction rollback |
| Redis | **No.** Rate limits are therefore per-instance — a known, recorded limitation |
| Email verification | **Out of scope.** Password reset is in scope; verify-on-signup is a future spec |

## Non-negotiable conventions

**Contracts and types**

- Every request/response shape is a zod schema in `packages/contracts`. A DTO or response type
  declared anywhere else is a review rejection — including a hand-written `interface` in the web app.
- Types are **inferred** (`z.infer<typeof schema>`), never hand-written beside the schema.
- `packages/contracts` depends on `zod` and nothing else.

**API**

- All routes under `/api/v1`. Specs write paths relative to that prefix.
- One error envelope, always: `{ error: { code, message, details?, requestId } }`. Clients branch on
  `code` (`SCREAMING_SNAKE_CASE`), never on `message`. A new `code` must appear in a spec before it
  appears in code.
- Cursor pagination on every list endpoint: `{ data, pageInfo: { nextCursor, hasNextPage } }`.
  Never offset.
- `JwtAuthGuard` is global via `APP_GUARD` with an opt-out `@Public()` decorator — endpoints are
  protected by default, so a forgotten decorator fails closed.
- `ZodValidationPipe` (`nestjs-zod`) is the global pipe. Unknown fields are a 400, never a silent
  drop — enforced by the schemas in `packages/contracts` being strict, which is what `whitelist` and
  `forbidNonWhitelisted` mean here. Nest's own `ValidationPipe` is **not** used: it hard-requires
  `class-validator`, the library [ARCHITECTURE.md § 9](ARCHITECTURE.md#9-open-decisions-for-review)
  decision 2 deliberately rejected, so wiring it back in would reintroduce the twice-declared shape
  that zod exists to prevent.
- Prisma error codes never reach a client: `P2002` → 409, `P2024`/`P1001` → 503, mapped in the
  persistence layer.
- Controllers route; services decide. A conditional with business meaning in a controller is wrong.

**Data**

- `cuid2` primary keys. No sequential integers in URLs.
- `timestamptz`, UTC, ISO-8601 with `Z` in JSON. The API never formats or localises a date.
- Metrics as `Decimal`, never `Float` — float rounding must not make two identical performances rank
  differently.
- Explicit `onDelete:` on every relation. Every filtered foreign key gets an index, with the reason
  in a comment.

**Documentation & diagrams**

- Every feature spec and `ARCHITECTURE.md` **must** contain valid Mermaid diagrams. Required by
  section: `erDiagram` for § 4, `sequenceDiagram` for any multi-request flow and `stateDiagram-v2`
  for any resource lifecycle in § 5, `flowchart` for the route map and redirect rules in § 6, plus
  the dependency graph, request path and critical-path sequence in `ARCHITECTURE.md`. Full table:
  [spec/README.md § Diagrams](spec/README.md#diagrams).
- **Validate before committing.** Run the `validate-diagrams` skill, or
  `npx --yes @mermaid-js/mermaid-cli -i file.mmd -o out.svg` per block. Mermaid's failure mode is a
  silently empty block, so a diagram you have not rendered is a diagram you have not written.
- Quote every node label (`A["POST /auth/login"]`) — unquoted `/`, `(`, `:` is the usual breakage.
  Label every edge. No colours and no `%%{init}%%` theme blocks: diagrams must read in light and
  dark. Keep to ~20 nodes; split beyond that.
- ASCII art is acceptable for **UI wireframes only**. Every other diagram is Mermaid.
- Diagrams never carry the contract. A status code, field rule or error `code` that appears only in
  a diagram does not exist — tests are written from § 5 and § 9.

**Frontend**

- Server Components by default. `"use client"` is opt-in, at leaves.
- The browser never calls NestJS directly. Everything goes through a Server Component, Server
  Action, or `app/api/*` route handler that holds the cookie.
- No global state library. Preference order: server props → URL search params → local
  `useState`/`useReducer` → React Query → a small `zustand` store for cross-tree UI prefs only.
- `proxy.ts` (not `middleware.ts` — Next 16 renamed it) does *optimistic* auth checks only: cookie
  presence, no API call, no DB read. The authoritative check is the Nest guard plus
  `requireSession()`.
- Forms must work with JS disabled; client validation is additive, never the enforcement point.
- Redirect params (`?next=`) are accepted only when they start with a single `/` and are not `//`.

**Security defaults**

- Argon2id for passwords, never bcrypt. Refresh and reset tokens stored as SHA-256 only.
- No endpoint distinguishes "account exists" from "wrong credentials".
- Never log passwords, tokens, token hashes, or reset URLs. IPs are hashed with a pepper.
- Secrets come from validated env vars. The app refuses to boot on missing or malformed config —
  no `process.env.X!` at a call site.

## Code style

- TypeScript strict everywhere. No `any`, no implicit types, explicit return types on functions.
- Small composable functions. No comments unless they explain genuinely non-obvious logic.
- No dead code, no commented-out blocks.
- Functional React components only. App Router patterns only.
- Co-locate component styles, tests and types with the component.
- Tailwind CSS v4, CSS-first config via `@theme`. No CSS-in-JS.
- `pnpm` only — never `npm` or `yarn`.
- Run `tsc --noEmit` after TypeScript changes.

## Commands (specified in spec 002 — not created yet)

```bash
cp .env.example .env
pnpm db:up          # docker compose up -d --wait postgres mailpit
pnpm db:migrate     # prisma migrate dev  (development only)
pnpm db:seed        # idempotent; refuses to run with NODE_ENV=production
pnpm dev            # turbo run dev — api :3001, web :3000
pnpm test:e2e       # starts the tmpfs test DB on :5433, then the Jest suite
pnpm db:deploy      # prisma migrate deploy — CI/production only
```

Mail in development is captured by Mailpit: SMTP on `:1025`, UI on <http://localhost:8025>.
Testing: Jest + Supertest for the API, Vitest + React Testing Library for the web,
Jest for `packages/typing-engine` (100% coverage required — the anti-cheat contract rests on it).

## Never

- Push to git. Stage and commit only; Nicolas pushes.
- Delete a file without asking first.
- Read or write `.env.local`.
- Write feature code before the tests for it are human-approved (§ The one rule).
- Leave `console.log` in committed code — use the pino logger.
- Add `@ts-ignore`, or `eslint-disable` without an explanation comment.
- Mix auto-formatting into a feature commit.
- Refactor outside the scope of the request.
- Tick a PR checklist box for a file that was not actually updated.
- Run migrations from a container `CMD` — two replicas would race.
- Commit a Mermaid diagram without rendering it first.
- Add a spec or edit `ARCHITECTURE.md` without the diagrams its sections require.

## Communication

Nicolas is a senior full-stack developer. Be concise, skip basics, explain *why* not just *what*.
When multiple viable approaches exist, give the trade-offs rather than silently picking. Ask before
large structural changes. State assumptions explicitly and flag what was left out.

## Open questions

Tracked in each spec's § 11. As of 2026-09-10, nothing blocks implementation. Outstanding:

- Production hosting topology and CD pipeline — its own future spec.

Resolved 2026-09-10, do not re-litigate: production mail is **Amazon SES** via
`@aws-sdk/client-sesv2`, credentials from the container's IAM task role, no static mail secret
(spec 001 § 10, Q22). Failed reset mails are **not retried** in v1 — no queue infrastructure, and
the resend button is the mitigation (Q23).

## Immediately next

Recommended order for the first test suites, per the cycle above:

1. `apps/api/src/config/env.schema.spec.ts` + `apps/api/test/infra.e2e-spec.ts` (spec 002 § 9) —
   nothing else can be tested until the test database and env validation are proven.
2. `packages/typing-engine` unit tests — pure, no infrastructure.
3. `apps/api/test/auth.e2e-spec.ts` and `password-reset.e2e-spec.ts` (spec 001 § 9) — the
   refresh grace-window branch needs fake-clock table coverage.
