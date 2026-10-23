# Source fulfillment

- [ ] Bind compose `49IlB-peymd7qk3ungmga` running images to exact source.
- [x] Preserve live `df06953` Prisma 6.19.0/minio-client fixes in the source branch; do not regress the deployed migration toolchain. Existing deployment is `Ir7cvFYGlwJWeeCrmlGwf`; no new Comp runtime deployment was attempted.
- [x] Verify actual remote-user roles and existing access boundary without exposing records: 2 users, 1 org, admin/admin+owner; browser Basic Auth and independent authenticated API.
- [ ] Package committed fork, covered dependencies, locks, build/install scripts and safe templates; exclude secrets/runtime data.
- [x] Implement source page/download under browser perimeter and session/API-key/service-token API access with no extra source role; 11 focused API and 3 route tests pass.
- [x] Freeze app/API build closures without new package versions or integrity changes; both frozen Docker dependency installs pass.
- [x] Replace the unused tracing SDK with a first-party opt-in OpenTelemetry adapter, preserving disabled-by-default live behavior and excluding prompt/response recording.
- [x] Recover and retain the exact published Dub gitHead's applicable AGPL grant/preferred source; remove unused Dub auth integration.
- [x] Replace General Sans app/portal assets with unchanged reviewed Inter/OFL; retain original font hashes as historical evidence.
- [x] Scope hosted/native duties to actual Sharp/libvips mappings and exact public source/build references. Remove the 3,249-archive publication gate; public unmodified build inputs have URLs/SRI, not invented licenses.
- [ ] Verify deterministic archives, exclusions, extracted builds and source-first release identity.
- [ ] Commit only intended changes, publish source before runtime, verify deployment and record hashes/tests.
