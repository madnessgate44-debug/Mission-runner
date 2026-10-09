# Self-host Mission Runner from a phone

This deployment is independent of TinyFish. It runs a private Playwright browser, a bounded GitHub API worker, a backend, PostgreSQL, and a mobile-friendly web control panel.

## What is implemented

- Owner login with a salted scrypt password hash and an HTTP-only encrypted session cookie.
- Mission V1 validation, SHA-256 content binding, server-computed risk, approval records, PostgreSQL persistence, cancellation and result storage.
- A GitHub worker that supports the explicit operation types in the shared contract and restricts work to both mission scope and a server-side repository allowlist.
- A Playwright browser worker with a persistent browser profile, manually controlled sign-in through the phone UI, explicit domain allowlists, request interception, DNS/IP checks, and signed internal requests.
- A phone-sized web control panel to log in, navigate the browser, type/click/press keys, create missions from JSON, approve missions, execute them, and view results.
- Docker Compose files for a persistent deployment.

## Important boundaries

- This code has not been deployed to a live server by this repository change. A host that can run Docker, a persistent disk, and HTTPS are still required.
- The browser profile contains live login sessions. Protect its volume like credentials, restrict server access, and use encrypted storage/backups. The AI is not given raw cookies or passwords.
- The browser uses Playwright/Chromium, not TinyFish. Some websites may detect headless automation or require additional login/SSO domains in the allowlist.
- Browser request interception plus DNS checks are defense-in-depth, not a substitute for network-level egress controls against every DNS-rebinding scenario. Do not expose worker ports publicly.
- Mission approval is required by policy for GitHub writes and browser click/type/form-submit operations. Approval is bound to the exact SHA-256 mission content.
- A green CI run validates code and tests; it does not prove a production deployment or successful login to every third-party website.
- This REST API/web panel is not automatically attached as a tool inside ChatGPT, Gemini, or DeepSeek. Each AI client must support and be configured for a tool/API/MCP connection before it can call this controller directly. The browser can be manually controlled through the web panel once deployed.

## Deploy with Docker

1. Use a server/VPS with Docker Compose and persistent volumes. The host must support Chromium dependencies and keep the browser_profile volume private. Do not publish ports 3000, 8791, or 8792.
2. Copy .env.example to .env. Generate random hex secrets; do not use the example placeholders.
3. Generate the owner password hash from an interactive terminal with hidden input:

       pnpm install --no-frozen-lockfile
       pnpm hash-password

   Copy the printed OWNER_PASSWORD_HASH=... value into .env. The plaintext password is not written to a file.
4. Set a fine-grained GitHub token with only the required permissions and repositories. Set GITHUB_REPO_ALLOWLIST to the same or narrower set.
5. Configure BROWSER_DOMAIN_ALLOWLIST with the website and authentication/SSO domains you intend to use. Start with a narrow list. Avoid * unless you explicitly accept allowing any public hostname.
6. Build and start the stack:

       docker compose up -d --build
       docker compose ps
       docker compose logs --tail=100 backend github-worker browser-worker web

7. Open http://SERVER:8080 for initial testing on a private network. Before using it over the public internet, put it behind HTTPS and an access-control layer. Do not send owner passwords or session cookies over plain HTTP on a public network.
8. Log in, open Browser, navigate to an allowlisted site, and sign in manually. The persistent browser profile keeps the site's session across worker restarts if its volume is preserved.
9. Open Missions & GitHub, paste a mission JSON plan, validate/save it, approve it when requested, then explicitly execute it.

## Test commands

From this directory:

    pnpm install --no-frozen-lockfile
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm validate:example
    pnpm build:web

The browser image downloads a matching Chromium build during Docker image creation. That can take several minutes and needs network access during the build.
