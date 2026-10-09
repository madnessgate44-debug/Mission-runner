# Mission Runner

Mission Runner is a personal AI operations platform with two engines:

1. **GitHub Operations Engine** — perform authorized, bounded repository operations
   (read files, list issues, open PRs, comment, create branches, etc.) through the
   GitHub REST API using least-privilege credentials.
2. **Browser Automation Engine** — drive a Playwright-controlled browser to navigate
   sites, inspect pages, interact with elements, run bounded multistep tasks, and
   capture evidence (screenshots, DOM snapshots, extracted text, console logs).

It is designed for a single owner who operates primarily from an **Android phone**
and is not a programmer.

## What this repository is

This is a **source-only** repository. Nothing here has been deployed, tested, or
uploaded on your behalf. You (or a reviewer) must build, configure, and run it.

## Trust model in one paragraph

The phone runs only a thin client. A **trusted backend** authenticates you, validates
missions against a versioned schema, enforces risk/approval rules, and dispatches
bounded jobs to two isolated workers. Credentials (GitHub tokens, owner session
secret) live only on the server, in environment variables or a proper secret store.
The client never holds a GitHub token and never speaks to GitHub or to a browser
directly.

## Assistant integration status (important)

**There is no live ChatGPT or Gemini integration in this repository.** ChatGPT and
Gemini can be used *off-device* to author a **provider-neutral Mission JSON v1**
document using the schema in `shared/schemas/`. You then paste or upload that JSON
into Mission Runner, where it is validated and executed under your policy. This is
intentional: fabricating an "assistant connector" that does not exist would be
misleading.

If you later add an official assistant API integration, it must flow through the
same backend validation and approval pipeline as manual missions.

## Architecture at a glance

    [ Android browser ]
            |
            v  HTTPS (session cookie)
    [ Backend API + policy ]  --->  [ GitHub worker ]  ---> GitHub REST API
            |                             ^
            |                             |
            v                             |
    [ Mission store + evidence ]          |
            |                             |
            v                             |
    [ Browser worker (Playwright) ] ------+

- Backend: Node.js + TypeScript, Fastify-style HTTP surface.
- Workers: separate processes/containers, no inbound network from the public internet.
- Store: PostgreSQL (or SQLite for local dev) for missions, operations, evidence index.
- Evidence blobs: filesystem or object storage; referenced by opaque ID.

## Local development vs production

- **Local dev**: `.env` file, SQLite allowed, Playwright runs on the host, GitHub
  token is a fine-grained PAT scoped to specific repos. Bind to `127.0.0.1`.
- **Production**: HTTPS-only reverse proxy, PostgreSQL, secret store (not a `.env`
  file in the image), GitHub App installation tokens preferred over PATs, browser
  worker in an isolated container with a domain allowlist and no host mounts.

Exact deployment requirements are documented in `docs/ARCHITECTURE.md` and
`docs/IMPLEMENTATION_PLAN.md`. Do not assume a paid service exists; each optional
dependency is called out.

## Repository layout

- `docs/` — architecture, security model, implementation plan, file manifest.
- `shared/` — versioned mission contract, status FSM, error taxonomy, JSON Schema.
- `backend/` — API, auth, policy, mission store, dispatcher (Package 2).
- `workers/github/` — GitHub executor (Package 3).
- `workers/browser/` — Playwright executor (Package 4).
- `web/` — mobile-first frontend (Package 5).
- `deploy/` — Dockerfiles, compose, reverse-proxy sample configs (Packages 2–5).

## Status of this package

**Package 1 delivers documentation, the shared mission contract, schemas, error and
status types, environment variable examples, and root project configuration.**
Backend, workers, and frontend are delivered in later packages.