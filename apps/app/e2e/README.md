# Focused authentication checks

`bun run test:e2e` runs `e2e/focused/*.spec.ts` as **ui-mocked** with one
Chromium worker and zero retries. Run commands from `apps/app` unless noted.

```bash
# Repository root; installation does not launch application lifecycle scripts.
bun install --ignore-scripts
# packages/auth
bun --no-env-file run build
# apps/app
bun --no-env-file run test:e2e:install chromium
bun --no-env-file run test:e2e:guards
bun --no-env-file run test:e2e
```

| Boundary       | What is exercised                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real code      | `src/proxy.ts` cookie gate, intent redirect/rewrite; `src/utils/auth.ts` forwarding cookies to `/api/auth/get-session`                                          |
| Fixture UI/API | `e2e/focused/server.ts`: synthetic magic-link button, HttpOnly cookie, in-memory session validation, expiry and sign-out                                        |
| Assertions     | Reload persistence, independent unauthenticated context, logout/replayed-cookie denial, server expiry with cookie still present, intent/header bypass rejection |
| Exclusions     | Actual Next pages/hydration/build, Nest/BetterAuth issuance/revocation, Postgres persistence, tenant/RBAC, mail, OAuth and workers                              |

`playwright.config.ts` starts an owned loopback fixture server, never `bun dev`
or Trigger. `E2E_PORT` defaults to `42170` and must be in `42170–42179`.
Occupied ports fail; existing servers are never reused. `/__ready` must match
the run ID and git revision before browser actions. The launcher uses an explicit
environment allowlist and Bun `--no-env-file`; no app dotenv loader runs.
Unexpected browser origins/WebSockets, page errors and server fetches fail the
suite. The session API fake runs in process; no external provider is contacted.
This is application-level containment, not an OS egress sandbox.

`test-results/<run-id>/` retains first-failure traces/screenshots; reports live in
`playwright-report/`. Both are ignored. Treat traces as private and remove them
after diagnosis. Do not save or commit reusable auth state.

## Disposable database preflight

`scripts/setup-e2e.sh` never reads `.env.test.local` or ambient `DATABASE_URL`.
It requires an explicitly provisioned local database and dedicated role; it does
not create a database or install browsers. Example uses synthetic credentials:

```bash
E2E_RUN_ID=0123456789abcdef \
E2E_DATABASE_URL='postgresql://comp_e2e:fixture@127.0.0.1:42179/comp_e2e_0123456789abcdef?schema=e2e_0123456789abcdef' \
./scripts/setup-e2e.sh --check
```

| Gate                             | Behavior                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| URL                              | `postgresql`, literal `127.0.0.1`, port `42170–42179`, role `comp_e2e`, nonempty password, run-matched database/schema, no extra query options |
| `--check`                        | Validate only; make zero database connections                                                                                                  |
| Setup without arguments          | Claim a fresh schema with `CREATE SCHEMA`, write/read its run-ID comment, then run local Prisma with a dedicated dotenv-free config            |
| Existing schema / wrong sentinel | Fail before Prisma; never adopt, reset or drop existing data                                                                                   |
| Prisma                           | No `--accept-data-loss`, migration reset, seed, generator or application launch                                                                |
| Disposal                         | On failure retain the claimed schema for diagnosis; operator disposes only the explicitly provisioned run database after checking its identity |

Real Postgres schema application and Nest/BetterAuth integration remain pending.
Provision a disposable local Postgres on a separate allowed port, run this setup,
then exercise actual magic-link/OTP issuance against a local mail sink, session
expiry/revocation and tenant denial with provider egress blocked. Prisma schema
push alone does not install migration-defined functions such as
`generate_prefixed_cuid`; validate migrations before seeding real users.

## Legacy suite boundary

`e2e/tests/` and `simple-auth.spec.ts` are historical onboarding tests and are
outside the focused default discovery. They need API-owned fixtures before reuse.
The deployed `test-login`, `test-db`, and `test-grant-access` routes now always
return `404`; no frontend test endpoint mutates users or grants access.
The API still has `emailAndPassword.enabled: false` in
`apps/api/src/auth/auth.server.ts`; do not enable passwords to revive old tests.

Pitfalls: build `packages/auth` before importing the session adapter; install the
browser matching the resolved Playwright version; preserve the parent run ID when
Playwright reloads config in workers. NextRequest normalizes loopback rewrite
hosts to `localhost`, so rewrite assertions check path/query.
