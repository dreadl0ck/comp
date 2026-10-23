# Modified Comp source

`LICENSE` retains Comp's AGPLv3 terms. Amsterdam Technologies modifications dated
2026-10-23 cover self-hosting fixes, authenticated source access, the optional
OTLP adapter and Inter replacement. `SOURCE-REVISION.json` binds the exact commit
and modification date. No warranty is provided; recipients retain the license's
copying, modification and redistribution rights without an NDA or code-host account.

## Scope

| Material | Delivery |
| --- | --- |
| Deployed work | `apps/app`, `apps/api`, `apps/portal` and the workspace packages used by their Docker targets. EE code, device agents and other applications are excluded. |
| Covered Dub source | `vendor-source/dub-embeds/` retains preferred TypeScript source/build configuration and the full upstream grant. `legal/source-evidence/dub-embeds.json` binds npm 0.0.16 to its published gitHead; that source snapshot's manifests say 0.0.15, preserved verbatim. Its embed paths are outside the upstream EE exceptions. |
| Public build inputs | `DEPENDENCY-SOURCES.json` records exact registry URLs, SHA-512 integrity and frozen profile membership. These unmodified upstream packages/build tools are not redistributed as a 3,249-archive superset and are not declared to share Comp's license. |
| Native libraries | `legal/source-evidence/native.json` identifies Sharp 0.34.5, libvips 8.17.3, exact public source commits/releases and retained original build recipes/licenses. They are unmodified general-purpose dependencies. Hosted operation does not itself convey backend/container copies to customers; future on-prem/native binary delivery needs its own applicable source/relink fulfillment. |
| Fonts | App and portal use unchanged Inter 4.001, SHA-256 `2dcd3612039a9aaa2660c0c9edd0f4b982e19d317af5ffe4161c37ddc803b5d0`. Both `public/fonts/` directories include the full OFL and original attribution/provenance. General Sans is removed from active inputs. |
| Exclusions | Production environments, credentials, evidence/uploads, database dumps and customer records are not source material. `source-scope.json` records the boundary. |

## Build

Use the pinned Bun 1.2.8 Docker builder. `build-locks/app.bun.lock` is shared by
app/portal; `build-locks/api.bun.lock` covers the API. Both installs are frozen.
`refresh-build-locks.py` regenerates only dependency-profile exports and checks
their package versions/integrity against root `bun.lock`.

```sh
docker build --target app -t comp-app .
docker build --target portal -t comp-portal .
docker build --target migrator -t comp-migrator .
docker build -f apps/api/Dockerfile.multistage --target production -t comp-api .
```

App/portal builds accept `NEXT_PUBLIC_BETTER_AUTH_URL`, `NEXT_PUBLIC_API_URL` and
`NEXT_PUBLIC_SELF_HOSTED=true`; app also accepts `NEXT_PUBLIC_PORTAL_URL`. Use
localhost origins for independent builds. Published images receive
`COMP_SOURCE_REVISION` and `COMP_SOURCE_SHA256` as build arguments; mount the
matching archive directory read-only at `/opt/comp-source` before startup.

`docker-compose.dokploy.yml` supplies build/install/startup commands and variable
names for PostgreSQL, Redis and storage. Supply fresh local credentials for
`DATABASE_URL`, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `SECRET_KEY`, service tokens,
Redis/storage credentials and your own external integrations. Production values
are neither needed nor supplied. Schema/migrations and generation scripts are
in `packages/db`; a source-only release does not require running production
migrations or seed jobs.

Optional tracing is disabled unless an explicit HTTPS collector (or local HTTP
collector) is configured through `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` or
`CATALYST_OTLP_ENDPOINT`. It uses standard Apache-2.0 OpenTelemetry components;
AI prompt/response recording is disabled. No provider endpoint is invented.

## Access

Browser users: `/source` and `/source/archive` use the existing perimeter gate.
API/portal users: `/v1/source`, `/v1/source/page` and `/v1/source/archive` use
existing session, API-key or service-token authentication without a source role.
The runtime revision and archive SHA-256 must match the published source.
