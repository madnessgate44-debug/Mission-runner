/**
 * Provider-neutral assistant authoring contract.
 *
 * There is NO live connector to ChatGPT or Gemini in Mission Runner. Instead,
 * the owner copies the prompt below into an assistant, and the assistant emits
 * a single JSON object conforming to Mission v1. That JSON is then pasted or
 * uploaded into Mission Runner and validated by the same code path used for
 * owner-authored missions.
 *
 * This module exists so that the prompt and the schema reference have a single
 * home in the codebase, and so that any future live integration reuses the same
 * shape rather than inventing a parallel one.
 */

import { MISSION_SCHEMA_VERSION_V1 } from "./version.js";

export interface AssistantAuthoringContext {
  /** e.g. "assistant:chatgpt". */
  createdBy: string;
  /** Absolute or documentation-relative path to the JSON Schema. */
  schemaPath: string;
  /** Known allowed repos, if any. Empty means "owner decides". */
  repoAllowlist: readonly string[];
  /** Known allowed domains, if any. Empty means "owner decides". */
  domainAllowlist: readonly string[];
  /** Free-form description of what the owner wants. */
  goal: string;
}

export function buildAssistantPrompt(ctx: AssistantAuthoringContext): string {
  const repos = ctx.repoAllowlist.length > 0 ? ctx.repoAllowlist.join(", ") : "(no repositories supplied; ask the owner before generating a mission)";
  const domains = ctx.domainAllowlist.length > 0 ? ctx.domainAllowlist.join(", ") : "(no domains supplied; ask the owner before generating a mission)";

  return [
    "You are helping author a Mission Runner mission document.",
    "",
    "Rules:",
    `- Output ONLY a single JSON object. No prose, no markdown fences.`,
    `- The object MUST conform to the Mission Runner schema at ${ctx.schemaPath}.`,
    `- Set "schemaVersion" to "${MISSION_SCHEMA_VERSION_V1}".`,
    `- Set "createdBy" to "${ctx.createdBy}".`,
    `- Use a fresh unique string for "missionId".`,
    `- Use an ISO 8601 UTC timestamp for "createdAt".`,
    `- Set "declaredRiskLevel" as an untrusted estimate; the server computes effective risk.`,
    `- Set "declaredRequiresApproval" as an untrusted hint; the server enforces approval policy.`,
    `- Use only targets explicitly supplied by the owner. Mission targets do not override server-side allowlists.`,
    `- If any required target is missing or the goal cannot be expressed, ask one clarification question and do not emit a Mission object yet.`,
    `- Keep "objective" to one short sentence.`,
    `- Provide "limits" as an object; the server will clamp them.`,
    `- Provide a "target" object with kind "github", "browser", or "mixed".`,
    `- Provide a non-empty "operations" array of typed operations.`,
    `- Do not include secrets, tokens, passwords, or personal data anywhere.`,

    "",
    "Available GitHub repos (owner allowlist):",
    `- ${repos}`,
    "",
    "Available browser domains (owner allowlist):",
    `- ${domains}`,
    "",
    "Owner goal:",
    ctx.goal,
    "",
    "Now output the Mission Runner mission JSON object.",
  ].join("\n");
}

/**
 * Provider labels that the client can offer in a picker. These are cosmetic:
 * they do not imply any live integration.
 */
export const ASSISTANT_PROVIDERS = [
  { id: "assistant:chatgpt", label: "ChatGPT" },
  { id: "assistant:gemini", label: "Gemini" },
  { id: "assistant:other", label: "Other assistant" },
] as const;

export type AssistantProviderId = (typeof ASSISTANT_PROVIDERS)[number]["id"];