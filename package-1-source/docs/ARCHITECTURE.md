# Mission Runner — Architecture

## 1. Goals and non-goals

### Goals
- Give a single owner a mobile-first way to run bounded GitHub and browser tasks.
- Accept **provider-neutral Mission JSON v1** authored by a human or by an assistant
  (ChatGPT, Gemini, or any other tool) with no privileged access.
- Keep all credentials server-side. Never let the client hold a GitHub token.
- Make every operation auditable: mission, operations, status transitions, evidence.
- Enforce least privilege on GitHub and strict sandboxing on the browser worker.
- Run on modest hosting. Do not require paid services unless clearly marked.

### Non-goals
- Multi-tenant SaaS. Mission Runner is single-owner by design.
- Live "chat with your repo" streaming. Operations are bounded jobs, not freeform agents.
- General-purpose shell execution. There is no shell operation in v1.
- Direct assistant API connectivity in Package 1.

## 2. Trust zones

### Zone A — Client (untrusted device)
The Android browser. Holds only a session cookie. Renders UI, authors/imports Mission
JSON, submits it, and views mission results and evidence. **Never** holds a GitHub
token, database credential, or Playwright capability.

### Zone B — Backend API (trusted)
Node.js + TypeScript service. Responsibilities:
- Owner authentication (session cookie + optional TOTP second factor).
- Mission schema validation (Mission v1).
- Risk classification and approval gating.
- Persistence of missions, operations, status transitions, and evidence index.
- Dispatch of bounded jobs to workers over a private channel.
- Rate limiting and per-mission quotas.

### Zone C — Workers (trusted but isolated)
- **GitHub worker**: holds a GitHub token; only performs operations listed in the
  mission and permitted by the token scope. Emits structured results + evidence.
- **Browser worker**: holds no owner credentials. Runs Playwright in a sandboxed
  container with a domain allowlist, egress logging, and hard time/size limits.
  Downloads go to a temp dir that is discarded after the mission.

## 3. Data flow

    Owner (Android)
       |  1. Author or paste Mission JSON v1
       v
    Backend API
       |  2. Validate schema, classify risk, require approval if needed
       |  3. Persist mission (status=validated | awaiting_approval)
       |  4. On approval: enqueue operations
       v
    Dispatcher ---------> GitHub worker  ----> GitHub REST API
       |                        |
       |                        v
       |                 structured result + evidence refs
       |                        |
       |   <--------------------+
       |                        |
       +--------> Browser worker ----> target sites (allowlisted)
                        |
                        v
                 structured result + evidence refs (screenshots, DOM, text)
       |
       v
    Backend stores transitions + evidence index
       |
       v
    Owner views status + evidence in the client

No arrow from the client goes directly to GitHub or to a target website.

## 4. Mission contract (summary)

A mission is a JSON document conforming to `shared/schemas/mission.v1.schema.json`. The server must recompute the SHA-256 digest over the validated immutable execution payload and store approval separately against that digest; a client-supplied `contentHash` is never trusted.
Top-level fields:

- `schemaVersion`: `"mission.v1"`
- `missionId`: opaque ID (UUIDv4 or ULID). Idempotent.
- `objective`: short human-readable goal.
- `createdBy`: `"owner" | "assistant:chatgpt" | "assistant:gemini" | "assistant:other"`
- `declaredRiskLevel`: untrusted author estimate; the server computes effective risk.
- `declaredRequiresApproval`: untrusted author hint; policy can always require approval.
- `limits`: object with timeouts, max operations, max bytes, max pages, etc.
- `target`: `{ kind: "github", ... } | { kind: "browser", ... } | { kind: "mixed", ... }`.
- `operations`: ordered list of typed operations.
- `metadata`: free-form, non-executable annotations.

Full details: `shared/src/mission.ts` and the JSON Schema.

## 5. Status finite-state machine (summary)

Mission statuses:
`draft → validated → awaiting_approval → approved → running → (succeeded | failed | cancelled | expired)`

Operation statuses:
`pending → dispatched → running → (succeeded | failed | skipped | cancelled)`

Transitions are enforced in `shared/src/status.ts`. A transition that is not in the
allowed set is a hard error, not a warning.

## 6. Idempotency

- Every mission has a `missionId`. Re-submitting the same `missionId` with the same
  content hash is a no-op that returns the existing mission.
- Every operation has an `operationId` and a derived `idempotencyKey` (see
  `shared/src/idempotency.ts`). The GitHub worker and browser worker both consult a
  persistent idempotency store before performing side effects (e.g., opening a PR).
- For GitHub write operations, before mutating, the worker records intent with the
  idempotency key; on retry it queries GitHub for the expected result (e.g., a PR
  with the same head/base/title) before acting again.

## 7. Evidence model

Evidence is stored out-of-band and referenced by ID. Types:

- `screenshot` (PNG), `dom_snapshot` (HTML or MHTML), `text_extract` (TXT/JSON),
  `console_log` (JSONL), `network_log` (JSONL), `file_diff` (unified diff),
  `api_response` (JSON, redacted), `note` (structured annotation).

Each evidence record has: `evidenceId`, `missionId`, `operationId`, `kind`,
`createdAt`, `contentType`, `sizeBytes`, `storageRef` (opaque), `sha256`, and
required `redactions` and `redactionPolicyVersion`. Raw secrets are never written to evidence; tokens and
`Authorization` headers are stripped by the workers before persistence.

## 8. Assistants: provider-neutral authoring

There is **no live connector** to ChatGPT or Gemini in Package 1. Instead:

1. The owner opens ChatGPT or Gemini and describes the desired outcome.
2. The assistant is instructed (by a prompt the owner pastes) to output a single
   JSON object conforming to Mission v1. The prompt template lives in
   `shared/src/assistant.ts` as a constant string, and the schema lives in
   `shared/schemas/mission.v1.schema.json`.
3. The owner copies that JSON into Mission Runner (paste or file upload).
4. The backend validates it exactly as it validates owner-authored missions.

Because both providers target the same schema and the same validator, a mission
authored by ChatGPT and one authored by Gemini are structurally identical. Any
future live integration must reuse this same path.

## 9. Hosting requirements

### Required for any non-local use
- A host that can run Docker (or a Node.js process plus a Playwright-capable base
  image). Both free-tier and paid options exist; the owner chooses.
- TLS termination (reverse proxy or platform-provided).
- Persistent storage for the mission store and evidence blobs.

### Local development
- Node.js 20+, pnpm 9+.
- Optional: Docker for the browser worker sandbox.
- SQLite is acceptable locally; PostgreSQL is expected in production.

Nothing in this repo assumes a specific paid vendor. Each optional service (Postgres,
object storage, TOTP) is marked "optional" where applicable.

## 10. Failure modes and boundaries

- Worker crash mid-mission: dispatcher retries up to `limits.maxRetries` with the
  same idempotency key; after exhaustion the operation becomes `failed` and the
  mission transitions to `failed`.
- Evidence size overflow: worker stops capturing, records a `note` evidence item
  explaining truncation, and continues if the operation allows.
- GitHub rate limit: worker backs off per GitHub's `Retry-After`/`X-RateLimit-Reset`;
  if the mission timeout expires first, the operation is `failed` with reason
  `rate_limited`.
- Browser navigation to a non-allowlisted domain: operation fails with reason
  `domain_not_allowed`. This is a policy failure, not a bug.
- Approval bypass attempt: policy forces `awaiting_approval` for `high` risk and for
  any operation tagged `write` on GitHub, regardless of the mission's
  `declaredRequiresApproval` value.