# Modified Comp source

`LICENSE` retains the upstream AGPLv3 terms. Local patches and the complete
workspace source are included at the revision named by the source manifest.
Recipients retain the license's copying/modification/redistribution rights;
source access imposes no NDA or separate code-host membership.

## Build

Use Bun 1.2.8 for the Docker build (`Dockerfile`, `apps/api/Dockerfile.multistage`).
`bun.lock` records registry dependency identities; preserve supplier licenses.

```sh
docker build --target app -t comp-app .
docker build --target portal -t comp-portal .
docker build --target migrator -t comp-migrator .
docker build -f apps/api/Dockerfile.multistage --target production -t comp-api .
```

The app build accepts `NEXT_PUBLIC_BETTER_AUTH_URL`, `NEXT_PUBLIC_PORTAL_URL`,
`NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SELF_HOSTED=true` as build arguments.
Use localhost URLs for independent builds. See `docker-compose.dokploy.yml` for
build targets, startup commands, PostgreSQL/Redis/storage services and variable
names. Supply fresh local credentials for `DATABASE_URL`, `POSTGRES_PASSWORD`,
`AUTH_SECRET`, `SECRET_KEY`, `REVALIDATION_SECRET`, `SERVICE_TOKEN_PORTAL`,
`SERVICE_TOKEN_TRIGGER`, `SRH_TOKEN` and storage credentials. Production values
are neither required nor supplied. `PUBLIC_URL`/`PUBLIC_PORTAL_URL` name your
own local origins. External integrations require recipients' own credentials.

Migrations/schema and seed/build scripts are in `packages/db`; no production
database or evidence files are needed to build. The existing deployment's
migration/seed behavior is not changed by source fulfillment.

## Access

Browser users: `/source` and `/source/archive` use the existing perimeter gate.
API users: `/v1/source` and `/v1/source/archive` accept the existing session,
API-key or service-token authentication without an additional source role.
The manifest's revision and SHA-256 must match the runtime build identity.
