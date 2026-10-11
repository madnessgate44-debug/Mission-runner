# Agent Zero Workbench: Proof of Concept

## Purpose

This branch prototypes the official Agent Zero framework as the coding environment behind Mission Runner. It does not depend on Brain being operational.

## What the workflow attempts

1. Accept a bounded task from an owner-only GitHub issue comment or workflow dispatch.
2. Start Ollama with a local coding model on a disposable GitHub Actions runner.
3. Start the official `agent0ai/agent-zero` Docker image with a private, per-run API key.
4. Send the task through Agent Zero's documented `POST /api_message` API.
5. Independently inspect the working tree and run a recognized test command.
6. Publish a candidate branch and draft PR only when the task call and tests both report success.
7. Upload evidence and stop the container.

## How to trigger (after the workflow is available on the selected branch)

- From an issue in Mission Runner, the repository owner can comment: `/company agent-zero <bounded task>`
- Or use Actions → Agent Zero Workbench Proof → Run workflow and provide the task.

Do not ask the agent to change workflows, secrets, access controls, or deployment settings. Those files are blocked from publication.

## Important limitations

- This is an unverified prototype until a real run proves Agent Zero boot, API authentication, local model access, repository edits, and independent tests.
- Local inference avoids a per-request model API fee but consumes runner time and memory. A 7B coding model may be slower or less capable than a strong hosted model.
- GitHub Actions is not unlimited compute. Public repositories using standard runners have different billing treatment from private repositories; private-repository free minutes and artifact storage are quota-limited.
- This does not provide an always-on Linux desktop. It provides an ephemeral computer-like work session with GitHub as durable storage.
- The current proof only edits the Mission Runner repository itself. Cross-repository targeting must be added after the runtime is verified, using a narrowly scoped secret such as `ARM_GITHUB_TOKEN` and explicit repository allowlists.
- No merge or deployment is performed.

## Required proof before adoption

- [ ] Workflow YAML parses and the workflow is discoverable by GitHub Actions.
- [ ] Official Agent Zero container starts successfully.
- [ ] The generated API key is accepted by `/api_message`.
- [ ] The configured Ollama model produces a real response.
- [ ] Agent Zero can modify only the mounted workbench.
- [ ] The runner independently observes the diff and tests.
- [ ] A safe candidate PR is created, with no token exposure.
- [ ] Quota/runtime failure produces a clear failed run and retained logs.

## Next design step

After this runtime proof passes, extend the workbench into a company control plane: issue-based intake, task decomposition, specialist passes, repository allowlists, independent reviewer, bounded repair/retest loops, and evidence-based draft PRs. Preserve the current Mission Runner UI and do not silently auto-push to a target repository's default branch.
