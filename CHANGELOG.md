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
  sessions, logs the user back in), which adds a `MailService` port with `smtp` / `ses` /
  `memory` drivers and a `PasswordResetToken` model. Added a 10-second refresh-rotation grace
  window so simultaneous multi-tab refreshes stop causing spurious logouts. Added
  `GET /users/me/sessions` and `DELETE /users/me/sessions/:id`, plus `PATCH /users/me/password`.
  Account deletion now anonymises results by default with an opt-in `deleteResults` flag. Added
  the full frontend page specification (§ 6): nine routes across three route groups, three layouts,
  eleven Server Actions, session helpers, `proxy.ts` matchers, and web-side budgets. Recorded
  immediate session revocation (one indexed query per authenticated request) and the per-instance
  rate-limit limitation that follows from running without Redis.
- `spec/features/001-authentication-and-users.md`: **revised after review** — fifteen defects and a
  batch of consistency errors resolved, recorded as Q6–Q21 in the spec's decision log. `Session`
  now models a **device** and a new `RefreshToken` model holds each rotation, which fixes six
  coupled defects at once: the device list showed one row per 15-minute refresh, `current: true`
  was undecidable, revoking a device left a 15-minute hole in the immediate-revocation guarantee,
  grace-window forks accumulated unbounded rows, "revoke all other sessions" had no definition, and
  the anti-cheat gate fired on every routine rotation. Token refresh is now confined to `proxy.ts`,
  Server Actions and route handlers — the three surfaces where Next.js permits a cookie write —
  because refreshing inside a Server Component render dropped the rotated token and tripped the
  spec's own reuse detector roughly every fifteen minutes. Per-IP rate limits and `ipHash` are
  keyed on a BFF-forwarded `X-Client-Ip`, trusted only from `TRUSTED_PROXY_CIDRS`; behind the BFF
  they were previously one global bucket. The cookie story is split into two named sets (`tg_*` on
  the API origin, `tgw_*` on the web origin with `Path=/` and `SameSite=Lax`), guest sessions are
  issued from `proxy.ts` on document navigations, session lifetime is absolute rather than sliding,
  reset mail is dispatched after the 202 instead of on the critical path, `PASSWORD_UNCHANGED` is
  gone from the unauthenticated reset endpoint, usernames accept Unicode with a single-script rule
  and a TR39 confusable skeleton, and a new cheap `GET /auth/session` serves the BFF session helper
  while `GET /users/me` drops aggregates. The Bearer transport is out of scope (it could not have
  worked: no response returned a refresh token to a body-only client), and 001 now creates a
  minimal `TestResult` that spec 003 extends. Eight Mermaid diagrams, all re-rendered.
- `spec/features/001-authentication-and-users.md`: **the last four open questions resolved**, moved
  to the decision log as Q22–Q25, leaving § 11 empty. Production mail is **Amazon SES** via
  `@aws-sdk/client-sesv2` rather than its SMTP endpoint, so the container's IAM task role signs the
  send and the production mail path holds no static secret; the trade-off given up is Resend's
  minutes-to-first-mail, against SES sandbox removal and manual DKIM/SPF/DMARC, all of it
  deploy-time work behind an unchanged `MailService` port. Failed reset mails are still not
  retried in v1, `passwordChangedAt` will not gain a re-login check (the session table already
  makes that guarantee strictly), and the 20-device session cap ships without a user-visible
  warning.
- `spec/features/002-database-and-docker.md`: mail env contract follows SES — `MAIL_DRIVER` is now
  `smtp | ses | memory`, `RESEND_API_KEY` replaced by a conditional `AWS_REGION` and an optional
  `SES_CONFIGURATION_SET`, with an edge case recording the one mail misconfiguration that cannot
  fail fast (credentials resolve lazily from the SDK provider chain, so a missing IAM role surfaces
  on the first send, not at boot).
- `spec/features/002-database-and-docker.md`: env contract extended for the above —
  `APP_PUBLIC_URL` (the API builds reset links and must not read a `NEXT_PUBLIC_*` variable),
  `TRUSTED_PROXY_CIDRS`, `SESSION_MAX_ACTIVE`, `GUEST_SESSION_TTL_DAYS`, the three Argon2 cost
  parameters, and `WEB_COOKIE_DOMAIN` on the web side.
- `spec/README.md`: the development-cycle table pointed step 3 at § 8 for the test plan; it is § 9.
- `ARCHITECTURE.md`: dropped the "no CORS surface" claim, which contradicted spec 002's required
  `CORS_ORIGIN`; documented the two API calls `proxy.ts` legitimately makes; recorded Bearer as out
  of scope in decision 4.
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
- Production mail provider resolved to **Amazon SES**; the remaining work (sandbox removal,
  verified domain identity, Easy DKIM, SPF, DMARC) is deploy-time and blocks the first send, not
  implementation. No spec now carries an open question that blocks work.

[Unreleased]: https://github.com/OWNER/typing-game/compare/HEAD
