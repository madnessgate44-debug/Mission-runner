# Mission Runner — File Manifest

Legend: `[P1]` delivered in Package 1, `[P2]`–`[P6]` planned for later packages.

## Root
- [P1] `README.md`
- [P1] `package.json`
- [P1] `pnpm-workspace.yaml`
- [P1] `tsconfig.base.json`\n- [P1] `tsconfig.json` (root project references)\n- [P1] `.eslintrc.json`
- [P1] `.gitignore`
- [P1] `.env.example`

## docs/
- [P1] `docs/ARCHITECTURE.md`
- [P1] `docs/SECURITY_MODEL.md`
- [P1] `docs/IMPLEMENTATION_PLAN.md`
- [P1] `docs/FILE_MANIFEST.md`

## shared/
- [P1] `shared/package.json`
- [P1] `shared/tsconfig.json`
- [P1] `shared/src/index.ts`
- [P1] `shared/src/version.ts`
- [P1] `shared/src/ids.ts`
- [P1] `shared/src/status.ts`
- [P1] `shared/src/errors.ts`
- [P1] `shared/src/limits.ts`
- [P1] `shared/src/risk.ts`
- [P1] `shared/src/evidence.ts`
- [P1] `shared/src/operations/github.ts`
- [P1] `shared/src/operations/browser.ts`
- [P1] `shared/src/operations/index.ts`
- [P1] `shared/src/mission.ts`
- [P1] `shared/src/validation.ts`
- [P1] `shared/src/idempotency.ts`
- [P1] `shared/src/assistant.ts`
- [P1] `shared/schemas/mission.v1.schema.json`
- [P1] `shared/schemas/mission.v1.example.json`\n\n## Tooling and tests\n- [P1] `scripts/validate-example.mjs`\n- [P1] `tests/package-1.test.mjs`\n- [P1] `.github/workflows/package-1-ci.yml` (repository CI)

## backend/ (Package 2)
- [P2] `backend/package.json`
- [P2] `backend/tsconfig.json`
- [P2] `backend/src/server.ts`
- [P2] `backend/src/config.ts`
- [P2] `backend/src/auth/session.ts`
- [P2] `backend/src/auth/totp.ts`
- [P2] `backend/src/auth/login.ts`
- [P2] `backend/src/policy/policy.ts`
- [P2] `backend/src/policy/approval.ts`
- [P2] `backend/src/missions/repository.ts`
- [P2] `backend/src/missions/service.ts`
- [P2] `backend/src/missions/routes.ts`
- [P2] `backend/src/dispatch/dispatcher.ts`
- [P2] `backend/src/dispatch/workerClient.ts`
- [P2] `backend/src/evidence/storage.ts`
- [P2] `backend/src/evidence/routes.ts`
- [P2] `backend/src/logging/logger.ts`
- [P2] `backend/src/logging/redact.ts`
- [P2] `backend/src/db/migrations/0001_init.sql`

## workers/github/ (Package 3)
- [P3] `workers/github/package.json`
- [P3] `workers/github/tsconfig.json`
- [P3] `workers/github/src/server.ts`
- [P3] `workers/github/src/client.ts`
- [P3] `workers/github/src/executor.ts`
- [P3] `workers/github/src/operations/*.ts`
- [P3] `workers/github/src/idempotency/store.ts`

## workers/browser/ (Package 4)
- [P4] `workers/browser/package.json`
- [P4] `workers/browser/tsconfig.json`
- [P4] `workers/browser/src/server.ts`
- [P4] `workers/browser/src/executor.ts`
- [P4] `workers/browser/src/operations/*.ts`
- [P4] `workers/browser/src/sandbox/allowlist.ts`
- [P4] `workers/browser/src/sandbox/limits.ts`
- [P4] `workers/browser/src/evidence/capture.ts`

## web/ (Package 5)
- [P5] `web/package.json`
- [P5] `web/index.html`
- [P5] `web/src/main.ts`
- [P5] `web/src/api.ts`
- [P5] `web/src/pages/*.ts`
- [P5] `web/src/styles.css`

## deploy/ (Package 6)
- [P6] `deploy/backend.Dockerfile`
- [P6] `deploy/github-worker.Dockerfile`
- [P6] `deploy/browser-worker.Dockerfile`
- [P6] `deploy/compose.yaml`
- [P6] `deploy/reverse-proxy/Caddyfile.example`
- [P6] `deploy/README.md`