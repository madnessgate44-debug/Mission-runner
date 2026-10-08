# Mission Runner / GitHub Arm

AI-agnostic execution arm for Ahmed's GitHub projects.

## Operating model

A trusted client submits one JSON mission to `.missions/inbox/mission-id.json`.

The GitHub Arm workflow starts automatically, executes the requested changes against the target repository, runs safe validations, pushes the target commit, and records the result in `.missions/results/mission-id.json`.

## Credential

Add a repository secret named `ARM_GITHUB_TOKEN` to `madnessgate44-debug/Mission-runner`. It must have the minimum contents/write permissions required for the target repositories.

The workflow falls back to the Actions `GITHUB_TOKEN`, which is normally scoped to Mission Runner itself.

Never put credentials in browser localStorage, mission JSON, or source files.

## Mission format

```json
{
  "id": "example-001",
  "target": {"owner": "madnessgate44-debug", "repo": "Example", "branch": "main"},
  "commitMessage": "Arm: update example",
  "changes": [
    {"action": "update", "path": "README.md", "content": "..."},
    {"action": "create", "path": "docs/NOTE.md", "content": "..."},
    {"action": "delete", "path": "old.txt"}
  ],
  "validation": ["npm run build", "npm test"]
}
```

Allowed validations: `npm test`, `npm run build`, `npm run lint`, `npm run typecheck`, `pytest`, `gradle test`.
