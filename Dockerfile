# =============================================================================
# STAGE 1: Dependencies - Install and cache workspace dependencies
# =============================================================================
FROM oven/bun:1.2.8 AS deps

WORKDIR /app

# Copy workspace configuration
COPY package.json bun.lock ./

# Copy package.json files for all packages.
#
# AT-PATCH: upstream's comment claims local db is excluded in favour of the
# published @trycompai/db, but apps/app and apps/portal both declare
# "@trycompai/db": "workspace:*" (as well as auth, billing and company), so
# bun must see those package.json files to resolve the workspace. Without
# them `bun install` dies with:
#     error: Workspace dependency "@trycompai/db" not found
#     error: @trycompai/auth@workspace:* failed to resolve
# The claim is also self-contradictory: the app-builder stage below runs
# `cd packages/db && node scripts/combine-schemas.js`, i.e. it uses the local
# package regardless. apps/api/Dockerfile.multistage already copies all four;
# this root Dockerfile just drifted behind the package.json files.
COPY packages/db/package.json ./packages/db/
COPY packages/auth/package.json ./packages/auth/
COPY packages/billing/package.json ./packages/billing/
COPY packages/company/package.json ./packages/company/
COPY packages/kv/package.json ./packages/kv/
COPY packages/ui/package.json ./packages/ui/
COPY packages/email/package.json ./packages/email/
COPY packages/integration-platform/package.json ./packages/integration-platform/
COPY packages/integrations/package.json ./packages/integrations/
COPY packages/utils/package.json ./packages/utils/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/analytics/package.json ./packages/analytics/

# Copy app package.json files
COPY apps/app/package.json ./apps/app/
COPY apps/portal/package.json ./apps/portal/

# Install all dependencies
RUN PRISMA_SKIP_POSTINSTALL_GENERATE=true bun install --ignore-scripts

# =============================================================================
# STAGE 2: Ultra-Minimal Migrator - Only Prisma
# =============================================================================
FROM oven/bun:1.2.8 AS migrator
ARG COMP_SOURCE_REVISION
ARG COMP_SOURCE_SHA256
LABEL org.opencontainers.image.revision=$COMP_SOURCE_REVISION com.amsterdam-technologies.source.sha256=$COMP_SOURCE_SHA256

WORKDIR /app

# Copy local Prisma schema, migrations and the schema-combining scripts.
# AT-PATCH: packages/db/src is required too -- seed.ts ends by importing
# ../../src/scripts/backfill-framework-versions, so without it the seed runs
# all the way through the framework data and then dies on the final backfill,
# leaving a half-seeded database. It is 40K and pulls in no new dependencies.
COPY packages/db/prisma ./packages/db/prisma
COPY packages/db/scripts ./packages/db/scripts
COPY packages/db/src ./packages/db/src

# AT-PATCH: two changes to the dependency set.
#   - added @prisma/adapter-pg, which prisma/seed/seed.ts imports but upstream
#     never declared, leaving the seed reliant on bun hoisting it transitively.
#   - dropped @trycompai/db. See the schema note below.
RUN echo '{"name":"migrator","type":"module","dependencies":{"prisma":"^6.14.0","@prisma/client":"^6.14.0","@prisma/adapter-pg":"^6.14.0","zod":"^3.25.7"}}' > package.json

# Install ONLY Prisma dependencies
RUN bun install

# AT-PATCH: a standalone datasource schema for `migrate deploy`.
#   The base prisma/schema.prisma declares no `url` because it drives the new
#   driver-adapter generator, where the connection is supplied at runtime by
#   PrismaPg. The migrate CLI still needs one, so upstream leaned on the
#   published @trycompai/db dist schema. `migrate deploy` only replays raw SQL
#   and never needs the models, so a minimal datasource is sufficient and does
#   not couple us to the published package's schema version.
RUN mkdir -p /app/migrate \
    && printf 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n' > /app/migrate/schema.prisma \
    && cp -R packages/db/prisma/migrations /app/migrate/migrations

# AT-PATCH: generate the client from the LOCAL prisma/schema/ tree, at build
# time, using the repo's own script.
#
# Upstream applied migrations from the local tree but generated the client
# from the published @trycompai/db schema. Those drift: at v3.111.1 the local
# schema has FrameworkEditorControlTemplate.documentTypes
# (prisma/schema/framework-editor.prisma:207) and @trycompai/db@1.3.22 does
# not, so the column exists in the database, the client does not know about
# it, and the seed dies with `Unknown argument 'documentTypes'`. Upstream's
# invocation also emitted the client into a nested
# node_modules/@trycompai/db/node_modules/.prisma that seed.ts's bare
# `import from '@prisma/client'` could never resolve.
#
# Run with bun, not node: oven/bun ships no node binary.
RUN cd packages/db && bun scripts/generate-prisma-client-js.js

CMD ["bunx", "prisma", "migrate", "deploy", "--schema=/app/migrate/schema.prisma"]

# =============================================================================
# STAGE 3: App Builder
# =============================================================================
FROM deps AS app-builder

WORKDIR /app

# Copy all source code needed for build
COPY packages ./packages
COPY apps/app ./apps/app

# Bring in node_modules for build and prisma prebuild
COPY --from=deps /app/node_modules ./node_modules

# Pre-combine schemas and generate the Prisma client into
# node_modules/@prisma/client. The deps stage ran `bun install` with
# `--ignore-scripts` so packages/db's postinstall was skipped; we run
# it explicitly here so `next build` can resolve the generated runtime
# + types when it imports @prisma/client.
# AT-PATCH: bun, not node -- the oven/bun base image ships no node binary,
# so these two RUN steps fail outright as written upstream. (`bun run <script>`
# works because bun shims `node` for package.json scripts; a bare RUN does not
# get that shim, which is what hid this.)
# AT-PATCH: full `bun run build` for packages/db, mirroring
# apps/api/Dockerfile.multistage, not just the two schema scripts.
# packages/db resolves through dist/, and other packages import it
# (packages/company/dist/index.mjs does `import ... from "@trycompai/db"`), so
# without tsc output the portal build fails with
#   ./packages/company/dist/index.mjs:2:1 Can't resolve '@trycompai/db'
# db's build runs generate-prisma-client-js, tsc and build-dist-schema, so it
# also produces dist/schema.prisma.
RUN cd packages/db && bun run build

# AT-PATCH: build the workspace packages the app imports.
# Every @trycompai/* package except utils resolves through dist/, and nothing
# in this stage compiled them, so the Next build failed with
#   Module not found: Can't resolve '@trycompai/auth'
# apps/api/Dockerfile.multistage already does this; the root Dockerfile only
# ever built packages/db.
RUN cd packages/auth && bun run build \
    && cd ../email && bun run build \
    && cd ../company && bun run build \
    && cd ../billing && bun run build \
    && cd ../integration-platform && bun run build \
    && cd ../analytics && bun run build \
    && cd ../kv && bun run build \
    && cd ../ui && bun run build

# AT-PATCH: same model-file copy as portal-builder. apps/app/build:docker also
# runs `prisma generate --schema=prisma/schema`, and apps/app/prisma/schema/
# likewise ships only the generator+datasource stub. Upstream did no copy at
# all here, so the app would generate a model-less client too.
RUN find /app/packages/db/prisma/schema -name '*.prisma' ! -name 'schema.prisma' \
    -exec cp {} /app/apps/app/prisma/schema/ \;

# Ensure Next build has required public env at build-time
ARG NEXT_PUBLIC_BETTER_AUTH_URL
ARG NEXT_PUBLIC_PORTAL_URL
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_IS_DUB_ENABLED
ARG NEXT_PUBLIC_API_URL
# AT-PATCH: NEXT_PUBLIC_SELF_HOSTED must be a BUILD ARG, not a runtime env.
#   SELF_HOSTING.md tells you to set it in apps/app/.env, but it is read from
#   server components (setup/actions/create-organization-minimal.ts and
#   upgrade/[orgId]/page.tsx) and Next inlines NEXT_PUBLIC_* at build time.
#   Set only at runtime it evaluates false and org creation drops into the
#   paid/booking flow instead of auto-approving.
ARG NEXT_PUBLIC_SELF_HOSTED
ENV NEXT_PUBLIC_SELF_HOSTED=$NEXT_PUBLIC_SELF_HOSTED \
    NEXT_PUBLIC_BETTER_AUTH_URL=$NEXT_PUBLIC_BETTER_AUTH_URL \
    NEXT_PUBLIC_PORTAL_URL=$NEXT_PUBLIC_PORTAL_URL \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_IS_DUB_ENABLED=$NEXT_PUBLIC_IS_DUB_ENABLED \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
    NEXT_OUTPUT_STANDALONE=true \
    NODE_OPTIONS=--max_old_space_size=6144

# Build the app
RUN cd apps/app && SKIP_ENV_VALIDATION=true bun run build:docker

# =============================================================================
# STAGE 4: App Production
# =============================================================================
FROM node:22-alpine AS app
ARG COMP_SOURCE_REVISION
ARG COMP_SOURCE_SHA256
ENV COMP_SOURCE_REVISION=$COMP_SOURCE_REVISION COMP_SOURCE_SHA256=$COMP_SOURCE_SHA256
LABEL org.opencontainers.image.revision=$COMP_SOURCE_REVISION com.amsterdam-technologies.source.sha256=$COMP_SOURCE_SHA256

WORKDIR /app

# Copy Next standalone output
COPY --from=app-builder /app/apps/app/.next/standalone ./
COPY --from=app-builder /app/apps/app/.next/static ./apps/app/.next/static
COPY --from=app-builder /app/apps/app/public ./apps/app/public

EXPOSE 3000
CMD ["node", "apps/app/server.js"]

# =============================================================================
# STAGE 5: Portal Builder
# =============================================================================
FROM deps AS portal-builder

WORKDIR /app

# Copy all source code needed for build
COPY packages ./packages
COPY apps/portal ./apps/portal

# Bring in node_modules for build and prisma prebuild
COPY --from=deps /app/node_modules ./node_modules

# Pre-combine schemas for portal build
# AT-PATCH: full build (see app-builder).
RUN cd packages/db && bun run build

# AT-PATCH: copy the Prisma MODEL files into apps/portal/prisma/schema/.
# apps/portal's build:docker runs `prisma generate --schema=prisma/schema`,
# i.e. against the DIRECTORY, which ships containing only schema.prisma (the
# generator + datasource stub). Upstream instead copied the combined schema to
# prisma/schema.prisma -- a file beside that directory, which generate never
# reads. The result is a client with no models, and the build dies with
#   Type error: Property 'policy' does not exist on type 'PrismaClient'
# This mirrors apps/api/Dockerfile.multistage and the repo's own db:getschema.
RUN find /app/packages/db/prisma/schema -name '*.prisma' ! -name 'schema.prisma' \
    -exec cp {} /app/apps/portal/prisma/schema/ \;

# AT-PATCH: same missing workspace package builds as app-builder. The portal
# imports @trycompai/auth and @trycompai/company directly
# (src/app/lib/auth-client.ts, src/utils/portal-access.ts).
RUN cd packages/auth && bun run build \
    && cd ../email && bun run build \
    && cd ../company && bun run build \
    && cd ../billing && bun run build \
    && cd ../integration-platform && bun run build \
    && cd ../analytics && bun run build \
    && cd ../kv && bun run build \
    && cd ../ui && bun run build

# Ensure Next build has required public env at build-time
ARG NEXT_PUBLIC_BETTER_AUTH_URL
ENV NEXT_PUBLIC_BETTER_AUTH_URL=$NEXT_PUBLIC_BETTER_AUTH_URL \
    NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
    NEXT_OUTPUT_STANDALONE=true \
    NODE_OPTIONS=--max_old_space_size=6144

# Build the portal
RUN cd apps/portal && SKIP_ENV_VALIDATION=true bun run build:docker

# =============================================================================
# STAGE 6: Portal Production
# =============================================================================
FROM node:22-alpine AS portal
ARG COMP_SOURCE_REVISION
ARG COMP_SOURCE_SHA256
ENV COMP_SOURCE_REVISION=$COMP_SOURCE_REVISION COMP_SOURCE_SHA256=$COMP_SOURCE_SHA256
LABEL org.opencontainers.image.revision=$COMP_SOURCE_REVISION com.amsterdam-technologies.source.sha256=$COMP_SOURCE_SHA256

WORKDIR /app

# Copy Next standalone output for portal
COPY --from=portal-builder /app/apps/portal/.next/standalone ./
COPY --from=portal-builder /app/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=portal-builder /app/apps/portal/public ./apps/portal/public

EXPOSE 3000
CMD ["node", "apps/portal/server.js"]

# (Trigger.dev hosted; no local runner stage)
