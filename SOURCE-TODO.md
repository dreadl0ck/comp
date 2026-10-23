# Source fulfillment

- [ ] Bind compose `49IlB-peymd7qk3ungmga` running images to exact source.
- [x] Preserve live `df06953` Prisma 6.19.0/minio-client fixes in the source branch; do not regress the deployed migration toolchain. Existing deployment is `Ir7cvFYGlwJWeeCrmlGwf`; no new Comp runtime deployment was attempted.
- [x] Verify actual remote-user roles and existing access boundary without exposing records: 2 users, 1 org, admin/admin+owner; browser Basic Auth and independent authenticated API.
- [ ] Package committed fork, covered dependencies, locks, build/install scripts and safe templates; exclude secrets/runtime data.
- [x] Implement source page/download under browser perimeter and session/API-key/service-token API access with no extra source role; 11 focused API and 3 route tests pass.
- [x] Freeze app/API build closures without new package versions or integrity changes; both frozen Docker dependency installs pass.
- [ ] Resolve `source-dependency-review.json` supplier-grant/native-source blockers before publication. 3,249 exact registry archives (1,737,962,404 bytes) acquired privately by SRI; acquisition is not permission.
- [ ] Verify source-bundle rights and credit delivery for General Sans 2.000 assets; embedded ITF terms/asset hashes are retained in `source-dependency-review.json`. Do not relabel font assets AGPL.
- [ ] Verify deterministic archives, exclusions, extracted builds and source-first release identity.
- [ ] Commit only intended changes, publish source before runtime, verify deployment and record hashes/tests.
