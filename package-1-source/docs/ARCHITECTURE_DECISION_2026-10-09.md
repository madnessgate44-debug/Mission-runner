# Architecture Decision Record — Mission Runner execution path

**Date:** 2026-10-09  
**Status:** Accepted for implementation; production deployment not approved.

## Decision

Mission V1 in `package-1-source/shared/` is the canonical contract for new work. The root `scripts/mission.js` + `.missions/inbox/*.json` GitHub Arm remains a legacy prototype until it is migrated or explicitly retired. New backend and worker code must not consume the legacy format directly.

## Why

The legacy mission uses `id`, `target.owner/repo/branch`, `changes`, and a list of validation commands. Mission V1 uses a versioned `missionId`, typed bounded operations, target scope, limits, risk declarations, SHA-256 content binding, and a separate approval record. Treating these as interchangeable would bypass the newer contract.

## Selected reuse strategy

- **GitHub API layer:** use GitHub's official MCP Server as an interoperability reference; the bounded worker remains the execution authority.
- **Browser layer:** use Playwright as the deterministic operation executor. Stagehand may be added later only for observation/locator discovery; it cannot bypass the operation allowlist or approval policy.
- **Open Browser Use:** do not adopt as the default phone-first worker because its documented connection model depends on a local desktop Chrome extension/native host.
- **Browser Use:** keep as a benchmark/alternative if bounded Playwright needs an agentic recovery layer.
- **Phone-first control:** browser UI is a client only. Secrets remain server-side; browser storage must not contain GitHub or model API keys.

## Current implementation boundary

The backend foundation now includes:
- owner-password verification using a salted scrypt hash;
- encrypted secure-session cookies;
- login rate limiting, security headers, and CSRF checks on state-changing endpoints;
- Mission V1 validation and server-computed SHA-256 content hash;
- effective-risk and approval-requirement computation;
- PostgreSQL mission persistence, list/get, content-bound approval, and cancellation.

Still **not implemented**:
- dispatch queue and authenticated worker protocol;
- GitHub execution worker;
- Playwright browser worker;
- evidence blob capture/storage and redaction pipeline;
- mobile web frontend;
- deployment configuration and end-to-end tests with actual GitHub/browser actions.

Until those exist and pass tests, this is a backend foundation, not a working autonomous controller. Approval currently changes the stored mission state; it does not dispatch execution.

## Release gates

1. All CI checks pass, including backend auth/API tests.
2. A dispatch contract is defined and authenticated with short-lived mission-bound authorization.
3. Worker-side target/domain enforcement independently rechecks mission hash, approval, limits, and operation allowlist.
4. GitHub write tests run against a disposable repository and create a reviewable pull request rather than pushing directly to a protected default branch.
5. Browser tests run against a benign test site, reject redirects/targets outside the allowlist, and redact secrets from evidence.
6. Phone-only flow is demonstrated end-to-end before advertising ChatGPT, Gemini, or DeepSeek as supported clients.
