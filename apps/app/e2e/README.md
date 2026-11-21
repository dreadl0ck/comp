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

## Real local authentication seam

`apps/api` now has `bun --no-env-file run test:auth-local`: **integration-local**,
3 serial tests against the actual `src/auth/auth.server.ts` BetterAuth instance,
its Prisma adapter, session hooks and organization plugin. This is the bounded
BetterAuth HTTP API fallback; Nest controllers/guards, Next login pages, SMTP
delivery and Trigger workers are outside this suite.

```bash
# packages/email (packages/auth must also be built, as above)
env -i PATH="$PATH" HOME="$HOME" bun --no-env-file run build
# apps/api; prepare the real API client's ignored generated schema/client
env -i PATH="$PATH" HOME="$HOME" bun --no-env-file run db:getschema
env -i PATH="$PATH" HOME="$HOME" bun --no-env-file ../../node_modules/prisma/build/index.js generate --schema prisma/schema
env -i PATH="$PATH" HOME="$HOME" bun --no-env-file run test:auth-local:guards
bun --no-env-file run test:auth-local
```

Prerequisites: local Docker engine, free loopback ports `42410–42411`, installed
workspace dependencies and Chromium matching `playwright-core` (install through
the existing `apps/app` browser-install command above). The exercised versions
were Bun `1.3.9`, Postgres `16.10`, Prisma `7.6.0`, BetterAuth `1.6.23` and
Playwright `1.61.1`; `bun.lock` is ignored by this repository.

| Contract         | Real assertion                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Magic link       | Capture rendered mail locally, consume actual verify URL in Chromium, assert HttpOnly/Lax signed cookie and DB-generated user/session IDs, reload and retain session                             |
| Logout/replay    | Actual sign-out deletes DB session; browser and old-cookie replay return null; consumed link cannot issue another session                                                                        |
| OTP/expiry       | Reject wrong code before successful login and reject consumed-code replay; expire DB session while retaining cookie and deny replay; expire verification row and refuse magic link               |
| Tenant isolation | Independent cookie jars/users create separate organizations; foreign reads/switches return 403 without foreign data or membership; own reads/reselection and fresh-login active-org hook succeed |
| Passwords        | Actual password endpoint returns `400 EMAIL_PASSWORD_DISABLED`; production options stay untouched                                                                                                |

`test/auth-local/run.ts` re-execs with an environment allowlist, discarding ambient
`DATABASE_URL`, mail/provider credentials and dotenv. It starts a digest-pinned
`postgres:16.10` container with unique database, password and run/revision labels.
Before schema changes it checks the container identity and DB role/name, then
writes and rereads the database ownership comment. It installs `pgcrypto` and
`generate_prefixed_cuid` verbatim from the initial migration, then pushes the
complete current canonical schema. This verifies current-schema auth persistence,
not historical migration replay. Both ports fail on collision; no server reuse.

The test replaces only the dotenv loader and `triggerEmail` transport with an
in-memory, non-delivering rendered-mail sink. Server fetches fail, HTTP clients
refuse nonlocal redirects, and Chromium blocks external origins/WebSockets and
service workers. This is application-level containment, not an OS egress sandbox.
`test:auth-local:guards` checks 6 unsafe DB configurations and preserves an unrelated
server during an API-port collision. All tests use one worker and zero retries.

`apps/api/test-results/auth-local/<run-id>/` retains private manifests and logs;
delete after diagnosis. The runner removes only its labeled container and anonymous
volume on success/failure; SIGKILL requires manual label-checked disposal. It
leaves the pulled image and generated clients available for subsequent runs.

Pitfalls: `db:getschema` must precede client generation or the API client has zero
models; Postgres readiness must use TCP, since initdb's temporary Unix listener
exits; Playwright APIRequestContext under Bun `1.3.9` misparses cookie-response
URLs, so HTTP fixtures use real fetch/Set-Cookie jars; BetterAuth clears active
organization on membership denial, and the suite asserts that persisted null.

Next seam: boot a bounded Nest module with `HybridAuthGuard`/`PermissionGuard`
and real tenant resource handlers against this owned DB, then connect actual
Next login pages. Full Nest startup still requires isolating application
dotenv/provider initialization; `dev` also starts Trigger and is unsuitable here.

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
