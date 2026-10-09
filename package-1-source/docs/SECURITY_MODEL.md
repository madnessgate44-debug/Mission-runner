# Mission Runner — Security Model

## 1. Assets to protect

1. **GitHub credentials** (fine-grained PAT or GitHub App private key / installation).
2. **Owner session secret** (cookie signing key, TOTP secret if enabled).
3. **Mission store contents** (targets, diffs, extracted page text may be sensitive).
4. **Evidence blobs** (screenshots may contain personal data).
5. **Browser worker capability** (ability to make outbound requests).

## 2. Threat model

### In scope
- Stolen Android device with an active session.
- Malicious or malformed Mission JSON (from an assistant, a pasted doc, or an
  attacker who obtained the mission upload endpoint).
- Prompt-injected assistant output that tries to exceed mission scope.
- A compromised target website attempting to exfiltrate data via the browser worker.
- Token leakage through logs, evidence, or error messages.

### Out of scope (documented, not defended here)
- Nation-state adversaries.
- Compromise of the hosting provider's control plane.
- Physical attacks on the server host.

## 3. Authentication and session

- Single owner. The backend has exactly one account.
- Login: owner password (Argon2id hash in env or secret store) → session cookie
  (`HttpOnly`, `Secure`, `SameSite=Lax`, short TTL, rotating).
- Optional TOTP second factor. If `OWNER_TOTP_SECRET` is set, TOTP is required.
- Session secret (`SESSION_SECRET`) is 32+ random bytes, stored only server-side.
- Rate limit login attempts; lock after N failures for a cooldown window.
- CSRF: state-changing endpoints require a CSRF token bound to the session.

## 4. Authorization and policy

Every mission passes through a **policy engine** before dispatch:

1. Schema validation (Mission v1).
2. Risk classification. Effective risk is `max(declared, computed)`.
3. Approval gate:
   - `high` risk → always `awaiting_approval`.
   - Any GitHub `write` operation → always `awaiting_approval`.
   - Browser `click`, `type`, and `submit_form` operations → always
     `awaiting_approval` under the default policy.
4. Limit clamp: mission `limits` are clamped to hard caps
   (`shared/src/limits.ts`). A mission cannot raise its own caps.
5. Domain allowlist check for browser operations.

A mission cannot escalate its own privileges. The client cannot override policy. `declaredRiskLevel`, `declaredRequiresApproval`, and any submitted `contentHash` are untrusted inputs; the server computes effective risk, approval requirement, and SHA-256 content binding. Approval records are stored separately and bind the exact immutable execution payload.

## 5. Secrets handling

- **Never** in the client bundle, never in git, never in mission JSON, never in
  evidence.
- Backend reads secrets from process env, populated by:
  - Local dev: `.env` file loaded by the dev script (git-ignored).
  - Production: platform secret store or Docker secrets; `.env` in the image is
    forbidden.
- `.env.example` contains placeholders only. Real values are never committed.
- Workers receive only the credentials they need:
  - GitHub worker: `GITHUB_TOKEN` (or GitHub App key + installation ID).
  - Browser worker: **no** GitHub credential, **no** owner session secret.

## 6. GitHub credential strategy

Preferred, in order:

1. **GitHub App** installed on selected repos, with narrow permissions
   (`contents: read/write` only if writes are needed, `issues: read/write`, etc.).
   The backend mints short-lived installation tokens per mission.
2. **Fine-grained PAT** scoped to specific repositories with the minimum permissions
   needed for the mission set you actually run.

Forbidden:
- Classic PATs with `repo` scope (too broad).
- Organization-wide tokens.
- Any token with `admin:*` unless a specific mission absolutely requires it, and then
  only with explicit per-mission approval.

The GitHub worker validates that the token's scopes cover the requested operations
before dispatching; if not, the mission fails fast with `insufficient_scope`.

## 7. Browser worker sandbox

- Runs in its own container.
- Non-root user.
- Read-only root filesystem except a temp scratch dir.
- No host mounts.
- Network egress restricted by an allowlist derived from the mission's target domains
  plus a small fixed set (e.g., the Playwright browser's update endpoint is disabled).
- Per-operation timeouts, per-mission total time cap, max pages, max bytes.
- Downloads captured to scratch, hashed, then discarded after evidence extraction.
- All console and network logs pass through a **redactor** that strips
  `Authorization`, `Cookie`, `Set-Cookie`, and any header the mission marks sensitive.
- No persistent browser profile between missions.

## 8. Logging and redaction

- Structured JSON logs. Every log line has `missionId` and `operationId` when in
  scope.
- Redactor runs on: request headers, response headers, console messages, evidence
  text. Known-sensitive keys: `authorization`, `cookie`, `set-cookie`, `x-api-key`,
  `proxy-authorization`, and any key matching `/token|secret|password|passwd|pwd/i`.
- Evidence redaction is recorded on every evidence record (`redactions: [...]`), including an empty array when nothing was removed, alongside `redactionPolicyVersion`. The hash covers the final redacted bytes.

## 9. Rate limiting and quotas

- Per-session API rate limit.
- Per-mission operation count and total time caps (hard-capped server-side).
- Per-day mission count cap (configurable).
- GitHub worker respects GitHub's own rate limits with backoff.
- Browser worker caps concurrent pages per mission (default 1).

## 10. Failure containment

- A failed operation does not automatically fail the mission unless the operation is
  declared `required`. Optional operations can fail without aborting.
- Worker crash → dispatcher retries with the same idempotency key.
- Repeated failures trip a circuit breaker that pauses new missions and requires
  owner re-approval.

## 11. What this model does NOT do

- It does not protect against an owner who pastes a malicious mission and then
  approves it. Approval is the human trust boundary.
- It does not attempt to detect prompt injection inside fetched page content. The
  browser worker never feeds fetched content back into an assistant automatically;
  content only becomes evidence.
- It does not provide multi-user isolation. This is a single-owner system.

## 12. Deployment checklist (security)

- [ ] `SESSION_SECRET` is 32+ random bytes and unique to this deployment.
- [ ] `OWNER_PASSWORD_HASH` uses Argon2id with a modern parameter set.
- [ ] TOTP enabled if the device is shared or the host is exposed.
- [ ] TLS terminated by a reverse proxy; HTTP redirects to HTTPS.
- [ ] Backend not reachable on a public interface without TLS.
- [ ] Workers not reachable from the public internet.
- [ ] GitHub token is fine-grained or GitHub App, least privilege.
- [ ] Browser worker runs non-root, read-only FS, allowlisted egress.
- [ ] Evidence blobs stored on encrypted storage if they may contain personal data.
- [ ] Logs shipped to a store with the same access controls as the mission store.