# Mission Runner — Implementation Plan

This plan is delivered in packages. Package 1 (this one) contains documentation,
the shared mission contract, schemas, error/status types, env examples, and root
project configuration. Later packages contain executable code.

**Nothing in any package has been run, deployed, or tested by the author of these
files. All code is source-only and must be reviewed, built, and run by the owner or
a reviewer.**

## Package 1 — Contracts, documentation, skeleton (this package)

Deliverables:
- `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, `docs/IMPLEMENTATION_PLAN.md`,
  `docs/FILE_MANIFEST.md`.
- `shared/` package: mission contract, status FSM, errors, limits, risk, evidence,
  operations, validation, idempotency, assistant authoring contract.
- JSON Schema + example for Mission v1.
- `.env.example`, root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
  `.gitignore`, `README.md`.

Exit criteria:
- Mission v1 schema is complete and stable.
- Status transitions are exhaustively enumerated and enforced.
- Error taxonomy covers schema, policy, dispatch, execution, and transport.
- No file contains real secrets or personal data.

## Package 2 — Backend API

Scope:
- Fastify (or equivalent) HTTP server in `backend/`.
- Owner auth: password + session cookie + optional TOTP.
- Mission endpoints: create, validate, approve, cancel, get, list.
- Policy engine wiring (risk + approval + limit clamp).
- Mission store (Postgres via a query builder or SQLite for dev).
- Evidence index + blob storage adapter (filesystem or S3-compatible).
- Dispatcher: private channel to workers (HTTP over a private network, or a queue).
- Structured logging with redaction.

Exit criteria:
- A manually crafted Mission v1 JSON from `shared/schemas/mission.v1.example.json`
  can be validated, approved, dispatched (to a stub worker), and its status read back.
- High-risk and GitHub-write missions are forced into `awaiting_approval`.
- Login is rate limited; CSRF enforced on state changes.

## Package 3 — GitHub worker

Scope:
- `workers/github/` service.
- GitHub REST client with token/app auth.
- Operation executors for the GitHub op union in `shared/src/operations/github.ts`.
- Idempotency store (per-op key).
- Evidence capture: API responses (redacted), file diffs, PR/issue refs.

Exit criteria:
- Read operations succeed against a test repo.
- Write operations (branch, file put, PR open, comment) succeed and are idempotent
  under retry with the same key.
- Insufficient scope is detected before mutation.

## Package 4 — Browser worker

Scope:
- `workers/browser/` service.
- Playwright executor for the browser op union in
  `shared/src/operations/browser.ts`.
- Sandboxed container: non-root, read-only FS, temp scratch, egress allowlist.
- Evidence capture: screenshots, DOM snapshots, text extracts, console/network logs
  (redacted), downloads (hashed, discarded after extraction).
- Hard limits: pages, bytes, time, concurrency.

Exit criteria:
- A multistep navigate → inspect → click → extract task runs end-to-end against a
  benign test page.
- A navigation to a non-allowlisted domain fails with `domain_not_allowed`.
- Evidence is stored and indexed; redaction is recorded.

## Package 5 — Frontend (mobile-first web app)

Scope:
- `web/` SPA, optimized for Android Chrome.
- Login, mission authoring (paste/upload Mission JSON), mission list, mission detail
  with status timeline and evidence viewer.
- Approval UI for `awaiting_approval` missions.
- Assistant prompt helper: copy-to-clipboard prompt that instructs ChatGPT/Gemini to
  emit Mission v1 JSON.

Exit criteria:
- Owner can complete the full loop on a phone: log in, paste a mission, approve it,
  watch it run, view evidence.
- No secret is ever present in the client bundle or network responses intended for
  the client.

## Package 6 — Deployment

Scope:
- Dockerfiles for backend and both workers.
- Compose file for local prod-like runs.
- Reverse-proxy sample config (Caddy or nginx) with TLS.
- Deployment doc covering: required env vars, secret store options, storage options,
  GitHub App setup steps, and explicit call-outs of any optional paid service.

Exit criteria:
- A reviewer can stand the system up from the docs without reading source.
- The security checklist in `docs/SECURITY_MODEL.md` can be ticked.

## Cross-cutting rules

- Every code package consumes `shared/` for types. No duplicated schemas.
- No package introduces a new status or error string without updating `shared/`.
- Idempotency keys are derived only via `shared/src/idempotency.ts`.
- Evidence is always referenced by ID; no raw blobs travel through the API to the
  client except via an authenticated evidence endpoint.

## Open questions deferred to later packages

- Choice of queue (in-process vs. Redis vs. Postgres-backed) — decided in Package 2
  based on the owner's hosting choice.
- Whether to add a GitHub App or stay on fine-grained PAT — decided by the owner at
  deployment time; both paths are supported by the contract.
- Whether to enable TOTP — recommended, but optional at the owner's discretion.