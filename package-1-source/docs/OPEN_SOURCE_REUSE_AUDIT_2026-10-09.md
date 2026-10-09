# Open-Source Reuse Audit — Mission Runner

**Audit date:** 2026-10-09  
**Repository reviewed:** madnessgate44-debug/Mission-runner  
**Scope:** Compare the Package 1 mission contract with three browser/GitHub projects. This is an architecture and integration-fit audit of documented entry points, package metadata, license files, security notes, and relevant Mission Runner operation contracts. It is not a claim that every source file in each external repository received a line-by-line security review.

## Executive decision

**Do not copy an entire external project into Mission Runner yet. Reuse narrow components behind our own mission contract.**

1. **GitHub execution:** Treat the official GitHub MCP Server as a reference and optional adapter, not as the whole GitHub worker. Keep Mission Runner's own worker API, approval policy, target scope, idempotency, and evidence format as the authority.
2. **Browser execution:** Implement the planned bounded Playwright worker against our current BrowserOperation contract first. Evaluate Stagehand only as an optional semantic-observation/action adapter if selector-only Playwright proves insufficient. Browser Use is an alternative agent framework, not a drop-in implementation of our operation executor.
3. **Do not select Open Browser Use as the core for the phone-first product.** Its documented path connects a local Chrome profile through a Chrome extension, Native Messaging, and a local native host. Its own security policy says it does not provide the higher-level site policy, operation allowlist, or user-approval workflow we require. It may be useful later as an optional desktop-browser adapter, but it does not solve the cloud worker / Android-only workflow by itself.
4. **Resolve a contract and security split before Package 2.** The active root workflow is .github/workflows/brain.yml and its executor is scripts/mission.js. It accepts inbox JSON with id, target, changes, and validation fields, then pushes changes directly to the target branch when validation passes. Package 1 instead defines Mission V1 with missionId, operations, risk declarations, limits, and a separately stored approval contract. These are different formats and execution models. The current root path also lacks a server-enforced approval step and explicit repository/domain allowlists. Do not silently maintain two mission formats or treat the existing path as production-safe.


## Existing root implementation findings

The recursive GitHub tree confirms that the active GitHub Actions workflow is .github/workflows/brain.yml, and the executor is scripts/mission.js. A second file exists at github/workflows/brain.yml, but that directory is not GitHub's recognized workflow directory; do not assume it is an active workflow.

### Root GitHub Arm workflow
- Trigger: a push to .missions/inbox/*.json or manual workflow dispatch.
- Permissions: contents: write for the Mission Runner repository; the executor uses ARM_GITHUB_TOKEN when configured and otherwise falls back to GITHUB_TOKEN.
- Mission format: id, target.owner/repo/branch, changes, commitMessage, validation. It is not Mission V1.
- Executor behavior: clones the specified repository/branch, applies create/update/delete changes, creates a commit, runs a small allowlist of validation commands, and pushes directly to the target branch if validations pass.
- Positive controls: basic mission ID checks, owner/repository/branch character checks, path traversal checks, a fixed validation-command allowlist, temporary clone cleanup, and validation before remote push.
- Critical gaps relative to the planned product: no approval record or approval pause; no server-owned target-repository allowlist; the mission chooses its target repository and branch; a configured ARM_GITHUB_TOKEN may authorize writes to every repository covered by that token; direct branch push rather than a reviewable pull request; no Mission V1 content-hash/approval binding; no durable per-operation idempotency; no independent worker policy boundary. The current implementation must be treated as a prototype, not as the final secure controller.
- Operational concern: the workflow commits its result files back into the same branch that contains the inbox. Concurrency is serialized, but the overall trigger/result lifecycle and duplicate/retry behavior need explicit tests before production use.

### Root browser UI
The root index.html is a separate static prototype. The inspected source stores the GitHub token and model API key in browser localStorage, sends GitHub API requests directly from the browser, and allows a configurable model API endpoint to receive the model key. Its message-rendering helper inserts assistant output through innerHTML, so untrusted model output can become executable markup/script in the same origin as the stored credentials. This conflicts with the Package 1 security model that secrets must not be present in browser storage and creates a credential-theft risk if malicious content reaches the renderer. Do not build the production phone UI on top of this credential-handling/rendering approach. Treat it as a visual prototype only until authentication, server-side secret storage, authorization, and safe text rendering are redesigned.

### Consequence for the architecture
We do not need to start from zero: the root GitHub Arm demonstrates a basic GitHub Actions-based execution path. However, it is not equivalent to the planned backend + bounded workers, and it does not enforce the new Package 1 policy contract. The next implementation decision is to either migrate this path behind Mission V1 validation/approval or freeze it as a separate legacy prototype and build the new worker architecture cleanly. Do not add another execution path until this decision is made.

## Candidate 1 — Open Browser Use

Repository: https://github.com/iFurySt/open-browser-use  
License: MIT (checked in the repository's LICENSE file).

### What it provides
- Chrome extension plus local native host/CLI.
- JavaScript/TypeScript, Python, and Go SDKs.
- MCP interface for browser tabs, navigation, CDP, action plans, and cleanup.
- Connects automation clients to a user's real Chrome profile and its existing sessions.

### Fit against Mission Runner
- **Good reference:** Browser-session attachment, tab ownership, browser tools, SDK/API boundaries.
- **Poor fit as our default worker:** The documented design depends on local Chrome + extension + Native Messaging + local host, rather than a headless browser worker dispatched by our backend.
- **Security gap relative to our requirements:** Its docs/SECURITY.md explicitly says the SDK/CLI do not implement a Codex-style site policy, command allowlist, or user approval workflow; upper layers must supply these. The document also lists client tokens, peer validation, and security-focused failure-path tests as planned hardening.
- **Phone constraint:** The documented native-host route is a desktop Chrome integration. It is not evidence that this can run inside Android Chrome or directly inside the ChatGPT Android app.

### Decision
**Do not adopt as the Package 4 browser worker.** Revisit only if we later want a separately authenticated desktop Chrome connector. If used, place it behind a dedicated adapter, restrict exposed tools, and add Mission Runner's own authentication, authorization, domain allowlist, approvals, audit trail, and redaction.

Sources:
- https://github.com/iFurySt/open-browser-use/blob/main/README.md
- https://github.com/iFurySt/open-browser-use/blob/main/docs/SECURITY.md
- https://github.com/iFurySt/open-browser-use/blob/main/LICENSE

## Candidate 2 — Browser Use

Repository: https://github.com/browser-use/browser-use  
License: MIT (checked in the repository's LICENSE file). Its current package metadata requires Python 3.11 or newer.

### What it provides
- Python browser-agent framework and CLI.
- Can run with a local browser, a remote browser over CDP, or its hosted browser service.
- Supports multiple model providers and many browser actions.
- Its repository distinguishes the open-source agent from hosted cloud browser and agent services.

### Fit against Mission Runner
- **Good reference / optional engine:** Browser attachment, remote CDP, action execution, and browser-agent testing.
- **Not a drop-in worker:** Its agent framework plans and runs browser tasks, whereas our Mission V1 sends explicit, bounded operations such as navigate, extract_text, click, type, and submit_form.
- **Control boundary:** We should not let a separate agent freely re-plan around the mission's target scope or approval requirements. If adopted, it must execute only inside a worker sandbox and remain subordinate to our policy engine.
- **Hosting/cost:** A local browser needs a host; a hosted browser is a separate service and may incur charges. Neither fact proves a fully free, phone-only deployment.

### Decision
**Keep as a benchmark and possible alternative, not the first integration.** Build the deterministic worker first. If we later need agentic recovery, evaluate Browser Use behind an explicit adapter with hard operation, domain, time, and spend limits.

Sources:
- https://github.com/browser-use/browser-use
- https://github.com/browser-use/browser-use/blob/main/pyproject.toml
- https://github.com/browser-use/browser-use/blob/main/LICENSE

## Candidate 3 — Stagehand

Repository: https://github.com/browserbase/stagehand  
License: MIT (checked in the repository's LICENSE file).

### What it provides
- Browser-agent SDK with observe, act, and schema-constrained extract patterns.
- Node.js/TypeScript support, with other SDKs documented in the repository.
- Can launch a local browser with a persistent user-data directory; it also integrates with Browserbase's managed cloud browsers.
- Its example explicitly demonstrates persistent cookies and instructs the model to identify fields while keeping credential values out of model prompts.

### Fit against Mission Runner
- **Good candidate for a narrow optional capability:** Semantic element observation or robust locator discovery when a plain CSS selector is brittle.
- **Not a replacement for the worker:** Its natural-language actions and model integration should not become an unbounded side channel around our Mission V1 operation list, approval records, or domain restrictions.
- **Secrets and privacy:** Persistent browser sessions and credentials need strict isolation per owner/session. Model prompts, traces, and evidence must not include passwords, cookies, authorization headers, or other secrets.
- **Deployment/cost:** Local browser execution requires a host; Browserbase is a managed service with its own credentials and pricing.

### Decision
**Best browser SDK to evaluate as an optional adapter after the basic Playwright worker exists.** Do not make it a mandatory dependency in Package 4 yet. Prototype one approved observe/locator-resolution operation, record the resulting selector/evidence, and then execute the actual click/type/submit through our own approval-gated executor.

Sources:
- https://github.com/browserbase/stagehand
- https://github.com/browserbase/stagehand/blob/main/LICENSE

## GitHub candidate — Official GitHub MCP Server

Repository: https://github.com/github/github-mcp-server  
License: MIT (checked in the repository's LICENSE file).

### What it provides
- Official GitHub MCP server for repository/file access, issues, pull requests, workflow intelligence, and related GitHub capabilities.
- Local and hosted deployment modes.
- Authentication options vary by deployment mode and include PAT/OAuth/GitHub App approaches; the project documents GitHub policies and governance.

### Fit against Mission Runner
- **Good reference / possible adapter:** Tool definitions, GitHub API integration, MCP interoperability, and least-privilege authentication patterns.
- **Not a complete execution controller:** It does not implement our end-to-end Mission V1 lifecycle, target-constrained operation sequence, per-mission approval binding, worker isolation, or our evidence/result schema.
- **AI app compatibility is not automatic:** An AI client must support the relevant MCP transport and be configured/authorized to connect. The existence of an MCP server does not mean every mobile AI app can connect to it directly.
- **Credential boundary:** Do not expose a broad GitHub token to the browser worker or to a public client. Prefer a GitHub App installation restricted to selected repositories and permissions, or a narrowly scoped fine-grained token when appropriate.

### Decision
**Use as a reference and optional integration path, but retain our own GitHub worker contract.** Compare the official server's operations against shared/src/operations/github.ts; adopt only operations that match our allowlisted union and approval policy. Do not expose all upstream tools by default.

Sources:
- https://github.com/github/github-mcp-server
- https://github.com/github/github-mcp-server/blob/main/docs/policies-and-governance.md
- https://github.com/github/github-mcp-server/blob/main/LICENSE

## Compatibility check against our Package 1 contract

Reviewed:
- package-1-source/shared/src/mission.ts
- package-1-source/shared/src/operations/github.ts
- package-1-source/shared/src/operations/browser.ts
- package-1-source/shared/src/operations/index.ts
- package-1-source/docs/SECURITY_MODEL.md
- package-1-source/docs/IMPLEMENTATION_PLAN.md
- package-1-source/package.json
- root README.md

| Requirement | Package 1 status | External-project conclusion |
|---|---|---|
| Provider-neutral mission JSON | Defined by Mission V1 | Keep it as the only canonical contract |
| GitHub read/write operations | Narrow typed union defined | Map worker operations to official GitHub APIs/MCP only where semantics match |
| Browser operation allowlist | Narrow typed union defined | Use Playwright as the deterministic executor; don't grant an external agent arbitrary browser authority |
| Approval for GitHub writes | Policy helper defined; backend not yet implemented | Backend must enforce and persist approval before dispatch |
| Approval for browser click/type/submit | Policy helper defined; backend not yet implemented | Enforce server-side; worker must reject unapproved mutations |
| Mission target/domain scope | Runtime validation checks declared scope; backend/worker enforcement is still future work | Worker must independently enforce allowlists and defend against redirects, DNS rebinding, and SSRF |
| Evidence and redaction metadata | Contract defined; storage/capture not implemented | All adapters must emit the same redacted evidence format |
| Mobile-first operation | Planned UI, not implemented | Keep the execution engine hosted; the phone should be the control surface, not the worker host |
| Compatibility with ChatGPT/Gemini/DeepSeek | Authoring contract allows multiple assistants; no universal direct app connection is implemented | Provide a documented JSON/MCP/HTTPS integration path per client capability; do not promise direct integration until tested |
| Root GitHub Arm format | Root README documents a separate inbox/workflow mission format | Reconcile with Mission V1 before adding another dispatcher |

## Required next steps, in order

1. **Reconcile the existing root GitHub Arm with Mission V1.** The active workflow and executor have now been located and reviewed. Decide whether to migrate them behind Mission V1 validation/approval or freeze them as a legacy prototype. Any conversion must be explicit, tested, and lossless for supported operations.
2. **Freeze the adapter boundary.** Define the internal worker request/response contract, authentication between backend and workers, mission ID/content-hash binding, approval proof, idempotency key, timeout, and evidence shape.
3. **Implement Package 2 policy/backend before allowing writes.** Package 1 has types and helper functions, not an enforcing production backend.
4. **Implement the GitHub worker using the narrow operation union.** Test against a disposable test repository, including permission denial, stale SHA, retries, target escape attempts, and redacted outputs.
5. **Implement the Playwright browser worker using the narrow operation union.** Add domain/redirect/DNS protections, isolated browser contexts, network egress restrictions, secret redaction, and approval checks before side effects.
6. **Only then run a Stagehand adapter experiment.** It should resolve one semantic target to a selector/evidence and return control to the approved deterministic executor; it must not execute a free-form chain of actions.

## Acceptance criteria for the reuse decision

- [ ] The root GitHub Arm and Mission V1 relationship is documented and covered by tests.
- [ ] No external framework can bypass Mission Runner approval, target allowlists, limits, or evidence redaction.
- [ ] The same Mission V1 task can be dispatched to the appropriate worker with deterministic, validated inputs.
- [ ] A browser action cannot mutate a site without an approval record bound to the exact mission content.
- [ ] A GitHub write cannot affect a repository outside the mission's approved target.
- [ ] A phone-only owner can submit, approve, monitor, and inspect evidence without needing to install a desktop tool.
- [ ] The production UI never stores GitHub or model API secrets in localStorage or exposes them to arbitrary client-configured endpoints.
- [ ] Actual compatibility is demonstrated for each AI client before that client is advertised as supported.

## Final recommendation

**Build Mission Runner's own control plane and bounded workers; reuse libraries and API integrations, not another product's full authority model.** Stagehand is the leading optional browser SDK candidate, the official GitHub MCP Server is the leading GitHub interoperability reference, and Open Browser Use is a possible later desktop-browser adapter. Browser Use remains a benchmark/alternative if the deterministic Playwright worker needs agentic recovery.

No external source code was copied by this audit. No execution worker or universal AI-app connection was implemented by this report.
