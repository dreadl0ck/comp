# Source fulfillment

- [x] Bind compose `49IlB-peymd7qk3ungmga` app/API/portal images to source `1dce14873964e946681e544c6fc43441a0068f4e`, archive SHA-256 `cec8d78e8e934b6b0e629f865b1afc4e75e59e7450e1b7a96dd3aca87aa2f571`; see `SOURCE-RELEASE.json`.
- [x] Preserve `df06953` Prisma 6.19.0/minio-client fixes from baseline deployment `Ir7cvFYGlwJWeeCrmlGwf`; source-first release `WifRjsOQBiwN1QQAFTLGf` supersedes it without running schema/seed jobs.
- [x] Verify actual remote-user roles and existing access boundary without exposing records: 2 users, 1 org, admin/admin+owner; browser Basic Auth and independent authenticated API.
- [x] Package 4,631 committed source/build files with covered Dub preferred source, supplier grants, original Inter terms and public dependency directions; exclude secrets, runtime records and the registry binary superset.
- [x] Implement source page/download under browser perimeter and session/API-key/service-token API access with no extra source role; verification is recorded in `SOURCE-RELEASE.json`.
- [x] Freeze app/API build closures without new package versions or integrity changes; both frozen Docker dependency installs pass.
- [x] Replace the unused tracing SDK with a first-party opt-in OpenTelemetry adapter, preserving disabled-by-default live behavior and excluding prompt/response recording.
- [x] Recover and retain the exact published Dub gitHead's applicable AGPL grant/preferred source; remove unused Dub auth integration.
- [x] Replace General Sans app/portal assets with unchanged reviewed Inter/OFL; retain original font hashes as historical evidence.
- [x] Scope hosted/native duties to actual Sharp/libvips mappings and exact public source/build references. Remove the 3,249-archive publication gate; public unmodified build inputs have URLs/SRI, not invented licenses.
- [x] Reproduce the archive hash; build app/API/portal from the extracted archive. Pass 17 API/auth/tracing/OpenAPI tests, 3 app route tests, 7 source/font packaging tests, 8 local built-image/UI checks and 2 production source-download browser journeys.
- [x] Publish source behind `comp-gate` before rollout; deploy tag `v3.111.2-selfhost.4` as `WifRjsOQBiwN1QQAFTLGf`. Existing API authentication downloads exact bytes without a source scope; unauthenticated source routes reject with 401.
- [x] Preserve 21 existing environment keys and append only 2 source identity keys. Roll only app/API/portal; PostgreSQL/Redis/MinIO IDs and migration/seed execution times remain unchanged. Restore the original default deployment command.

Pitfalls: Dokploy's custom command field contains arguments after `docker`, not
the full CLI command. The pinned native build recipe needs an explicit ignore
exception. Local Docker internal networks need an owned bridge proxy for browser
tests. The upstream CSS view transition can emit a source-navigation-only
`AbortError: Transition was skipped`; the harness records that exact expected
abort and still checks real keyboard navigation/download bytes.
