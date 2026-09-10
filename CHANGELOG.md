# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `ARCHITECTURE.md` describing the target architecture: pnpm + Turborepo monorepo
  (`apps/api` NestJS, `apps/web` Next.js App Router, `packages/contracts`,
  `packages/typing-engine`), the Next.js-as-BFF boundary, state-management rules, the testing
  strategy per layer, and the Docker/Postgres local-development setup.
- `spec/README.md` defining Spec-Driven Development conventions: spec lifecycle and statuses,
  the required section template for a feature spec, the shared API error envelope, pagination
  and ID conventions, and the mandatory TDD cycle with its human approval gate.
- `spec/features/001-authentication-and-users.md` — user model, registration and login,
  Argon2id password hashing, JWT access tokens with rotating refresh tokens, httpOnly cookie
  and Bearer transports, guest sessions with a result-claim flow, user settings, account
  deletion, full API contracts and error cases, and anti-cheat touchpoints.
- `spec/features/002-database-and-docker.md` — Postgres 17 via `docker-compose`, connection and
  pooling policy, Prisma migration workflow (development, CI, production), seed data,
  multi-stage Dockerfiles for both apps, the env-var contract with zod validation, the
  throwaway test database, and backup/restore procedures.

### Changed

- `spec/README.md`: added two mandatory spec sections — **6. Frontend pages & routes** (route map,
  layouts, per-page data/actions/states/error-mapping/a11y; backend-only specs state *"Not
  applicable"* so section numbers stay aligned across specs) and **10. Decision log** (append-only
  record of resolved questions). Relaxed the 600-line guideline to allow a spec to stay whole when
  it records why.
- `spec/features/001-authentication-and-users.md`: all five open questions resolved. Password reset
  pulled into scope (single-use emailed token, 30-minute TTL, supersedes prior tokens, revokes all
  sessions, logs the user back in), which adds a `MailService` port with `smtp` / `resend` /
  `memory` drivers and a `PasswordResetToken` model. Added a 10-second refresh-rotation grace
  window so simultaneous multi-tab refreshes stop causing spurious logouts. Added
  `GET /users/me/sessions` and `DELETE /users/me/sessions/:id`, plus `PATCH /users/me/password`.
  Account deletion now anonymises results by default with an opt-in `deleteResults` flag. Added
  the full frontend page specification (§ 6): nine routes across three route groups, three layouts,
  eleven Server Actions, session helpers, `proxy.ts` matchers, and web-side budgets. Recorded
  immediate session revocation (one indexed query per authenticated request) and the per-instance
  rate-limit limitation that follows from running without Redis.
- `spec/features/002-database-and-docker.md`: all five open questions resolved — infrastructure-only
  Compose, long-lived container deployment, Prisma, truncate-based test isolation, no Redis. Added
  Mailpit to the default Compose profile, the mail and refresh-grace environment variables with
  conditional (driver-dependent) validation, and the matching edge cases and CI checks.
- **Mermaid diagrams are now mandatory** in every feature spec and in `ARCHITECTURE.md`, specified
  in [spec/README.md § Diagrams](spec/README.md#diagrams): which diagram type each section must
  carry, the style rules that keep blocks parseable and legible in both light and dark themes, and
  CI enforcement via `pnpm docs:diagrams` (extracts every fenced block and runs `mermaid.parse()`,
  failing the build on a parse error). Twelve diagrams added and validated by rendering:
  dependency graph, BFF trust boundary, Docker topology and the completed-test sequence in
  `ARCHITECTURE.md`; the development cycle in `spec/README.md`; the entity model, session-rotation
  state machine, password-reset sequence, route map and proxy redirect rules in spec 001; the
  migration lifecycle and test-database lifecycle in spec 002. ASCII art is retained only for UI
  wireframes, which Mermaid cannot express.
- `ARCHITECTURE.md`: confirmed all five open decisions (zod validation with shared inferred types
  being the last), added the `packages/contracts` rules that keep the two sides from drifting, added `MailModule` and the `(auth)`
  route group to the layout, and noted Mailpit in the default Compose profile.

### Notes

- No application code, dependency manifests, or infrastructure files exist yet. Everything in
  this release is specification: implementation begins only once the specs are approved and the
  first test suite is signed off.
- `CLAUDE.md` added at the repository root: the operating contract for coding agents in this repo —
  the SDD cycle and its human gateway, the confirmed decisions, the diagram requirements, and the
  conventions that are not inferable from an empty tree.
- **All architectural decisions are now confirmed** — the last one, DTO validation, resolved to
  zod schemas in `packages/contracts` shared by both apps with types inferred via `z.infer`. This
  deliberately overrides the `class-validator` default; the trade-off (OpenAPI generation moves to
  `nestjs-zod`) is recorded in
  [ARCHITECTURE.md § 9](ARCHITECTURE.md#9-open-decisions-for-review), decision 2. Nothing blocks
  implementation.
- Production mail provider (Resend / Postmark / SES) is unresolved but blocks only the first
  deploy, not implementation — the `MailService` port isolates the choice.

[Unreleased]: https://github.com/OWNER/typing-game/compare/HEAD
