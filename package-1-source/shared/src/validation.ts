/**
 * Hand-written validators for Mission v1.
 *
 * These validators are intentionally dependency-free so the same code can run
 * in the backend, in workers, and in tests. They do not replace the JSON Schema
 * (shared/schemas/mission.v1.schema.json); the schema is the normative artifact,
 * and these functions are the runtime implementation of it.
 */

import type { MissionV1 } from "./mission.js";
import { MISSION_CREATORS } from "./mission.js";
import { RISK_LEVELS } from "./risk.js";
import { SUPPORTED_MISSION_SCHEMA_VERSIONS } from "./version.js";
import { isMissionOperation, type MissionOperation } from "./operations/index.js";
import { clampMissionLimits, type MissionLimits } from "./limits.js";
import { isWellFormedId } from "./ids.js";
import { MissionRunnerError, makeError } from "./errors.js";

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day && hour <= 23 && minute <= 59 && second <= 59;
}

function validateTarget(target: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(target)) {
    issues.push({ path: "target", code: "field_invalid", message: "target must be an object" });
    return;
  }
  const kind = target.kind;
  const allowed = kind === "github" ? ["kind", "repos"] :
    kind === "browser" ? ["kind", "domains"] :
    kind === "mixed" ? ["kind", "repos", "domains"] : ["kind"];
  for (const key of Object.keys(target)) {
    if (!allowed.includes(key)) issues.push({ path: `target.${key}`, code: "field_unknown", message: "unknown target property" });
  }
  const validateRepos = (repos: unknown, path: string) => {
    if (!Array.isArray(repos) || repos.length === 0 ||
      !repos.every((repo) => typeof repo === "string" && /^[^/\s]+\/[^/\s]+$/.test(repo))) {
      issues.push({ path, code: "field_invalid", message: "must be a non-empty array of owner/repository strings" });
    }
  };
  const validateDomains = (domains: unknown, path: string) => {
    if (!Array.isArray(domains) || domains.length === 0 ||
      !domains.every((domain) => typeof domain === "string" && domain.length <= 253 &&
        /^(?:\*\.)?[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(domain) &&
        !domain.includes(".."))) {
      issues.push({ path, code: "field_invalid", message: "must be a non-empty array of hostnames" });
    }
  };
  if (kind === "github") validateRepos(target.repos, "target.repos");
  else if (kind === "browser") validateDomains(target.domains, "target.domains");
  else if (kind === "mixed") {
    validateRepos(target.repos, "target.repos");
    validateDomains(target.domains, "target.domains");
  } else {
    issues.push({ path: "target.kind", code: "field_invalid", message: "target.kind must be github, browser, or mixed" });
  }
}

function validateMetadata(metadata: unknown, issues: ValidationIssue[]): void {
  if (metadata === undefined) return;
  if (!isPlainObject(metadata)) {
    issues.push({ path: "metadata", code: "field_invalid", message: "metadata must be an object" });
    return;
  }
  const entries = Object.entries(metadata);
  if (entries.length > 50) issues.push({ path: "metadata", code: "field_invalid", message: "metadata may contain at most 50 entries" });
  for (const [key, value] of entries) {
    if (!key || key.length > 64) issues.push({ path: `metadata.${key}`, code: "field_invalid", message: "metadata keys must be 1–64 characters" });
    const okType = value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
    if (!okType || (typeof value === "number" && !Number.isFinite(value)) ||
      (typeof value === "string" && value.length > 1000)) {
      issues.push({ path: `metadata.${key}`, code: "field_invalid", message: "metadata values must be bounded string, finite number, boolean, or null" });
    }
  }
}

const OPERATION_KEYS: Record<string, readonly string[]> = {
  read_file: ["repo", "path", "ref", "encoding"],
  list_files: ["repo", "path", "ref"],
  list_issues: ["repo", "state", "labels", "limit"],
  get_issue: ["repo", "issueNumber"],
  list_pull_requests: ["repo", "state", "limit"],
  get_pull_request: ["repo", "pullNumber"],
  list_commits: ["repo", "ref", "limit"],
  create_branch: ["repo", "branch", "fromRef"],
  put_file: ["repo", "path", "branch", "content", "commitMessage", "expectedSha"],
  open_pull_request: ["repo", "head", "base", "title", "body", "draft"],
  comment_on_issue: ["repo", "issueNumber", "body"],
  comment_on_pull_request: ["repo", "pullNumber", "body"],
  navigate: ["url", "waitUntil", "settleMs"],
  screenshot: ["label", "fullPage"],
  extract_text: ["selector", "attribute", "maxChars"],
  click: ["selector", "timeoutMs"],
  type: ["selector", "text", "clear", "timeoutMs"],
  wait_for_selector: ["selector", "state", "timeoutMs"],
  submit_form: ["selector", "timeoutMs"],
  assert_text: ["selector", "contains", "timeoutMs"],
  get_url: [],
  get_title: [],
};
const OPERATION_REQUIRED: Record<string, readonly string[]> = {
  read_file: ["repo", "path"], list_files: ["repo", "path"], list_issues: ["repo"],
  get_issue: ["repo", "issueNumber"], list_pull_requests: ["repo"], get_pull_request: ["repo", "pullNumber"],
  list_commits: ["repo"], create_branch: ["repo", "branch", "fromRef"],
  put_file: ["repo", "path", "branch", "content", "commitMessage"],
  open_pull_request: ["repo", "head", "base", "title"],
  comment_on_issue: ["repo", "issueNumber", "body"], comment_on_pull_request: ["repo", "pullNumber", "body"],
  navigate: ["url"], click: ["selector"], type: ["selector", "text"], wait_for_selector: ["selector"],
  submit_form: ["selector"], assert_text: ["selector", "contains"],
};
function validateOperation(op: unknown, index: number, issues: ValidationIssue[]): op is MissionOperation {
  const path = `operations[${index}]`;
  if (!isPlainObject(op) || (op.kind !== "github" && op.kind !== "browser") || typeof op.op !== "string" ||
      !isMissionOperation(op)) {
    issues.push({ path, code: "operation_unsupported", message: "operation is not a recognized GitHub or browser operation" });
    return false;
  }
  const keys = ["kind", "op", "operationId", "required", "description", ...(OPERATION_KEYS[op.op] ?? [])];
  for (const key of Object.keys(op)) {
    if (!keys.includes(key)) issues.push({ path: `${path}.${key}`, code: "field_unknown", message: "unknown operation property" });
  }
  for (const key of OPERATION_REQUIRED[op.op] ?? []) {
    if (!(key in op)) issues.push({ path: `${path}.${key}`, code: "field_required", message: "required operation property is missing" });
  }
  const stringKeys = ["repo", "path", "branch", "content", "commitMessage", "expectedSha", "head", "base", "title", "body", "url", "label", "selector", "attribute", "text", "contains"];
  for (const key of stringKeys) if (key in op && typeof op[key] !== "string") {
    issues.push({ path: `${path}.${key}`, code: "field_invalid", message: "must be a string" });
  }
  for (const key of ["repo"]) if (typeof op[key] === "string" && !/^[^/\s]+\/[^/\s]+$/.test(op[key] as string)) {
    issues.push({ path: `${path}.${key}`, code: "field_invalid", message: "must be owner/repository" });
  }
  for (const key of ["issueNumber", "pullNumber", "limit", "maxChars", "settleMs", "timeoutMs"]) {
    if (key in op && (typeof op[key] !== "number" || !Number.isInteger(op[key]) || (op[key] as number) < (key === "settleMs" || key === "timeoutMs" ? 0 : 1))) {
      issues.push({ path: `${path}.${key}`, code: "field_invalid", message: "must be a valid integer in range" });
    }
  }
  for (const key of ["required", "draft", "fullPage", "clear"]) if (key in op && typeof op[key] !== "boolean") {
    issues.push({ path: `${path}.${key}`, code: "field_invalid", message: "must be a boolean" });
  }
  if ("labels" in op && (!Array.isArray(op.labels) || !op.labels.every((v) => typeof v === "string"))) {
    issues.push({ path: `${path}.labels`, code: "field_invalid", message: "must be an array of strings" });
  }
  if ("encoding" in op && op.encoding !== "utf8" && op.encoding !== "base64") issues.push({ path: `${path}.encoding`, code: "field_invalid", message: "must be utf8 or base64" });
  if ("state" in op && !["open", "closed", "all", "attached", "detached", "visible", "hidden"].includes(String(op.state))) issues.push({ path: `${path}.state`, code: "field_invalid", message: "invalid state value" });
  if ("waitUntil" in op && !["load", "domcontentloaded", "networkidle"].includes(String(op.waitUntil))) issues.push({ path: `${path}.waitUntil`, code: "field_invalid", message: "invalid waitUntil value" });
  if ("ref" in op && !validGitHubRef(op.ref)) issues.push({ path: `${path}.ref`, code: "field_invalid", message: "invalid GitHub ref" });
  if ("fromRef" in op && !validGitHubRef(op.fromRef)) issues.push({ path: `${path}.fromRef`, code: "field_invalid", message: "invalid GitHub ref" });
  if (op.kind === "browser" && op.op === "navigate") {
    try { const u = new URL(String(op.url)); if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(); }
    catch { issues.push({ path: `${path}.url`, code: "field_invalid", message: "url must be an absolute HTTP(S) URL" }); }
  }
  return true;
}
function validGitHubRef(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (value.type === "branch" || value.type === "tag") return typeof value.name === "string" && value.name.length > 0 && Object.keys(value).every((k) => ["type", "name"].includes(k));
  if (value.type === "commit") return typeof value.sha === "string" && value.sha.length >= 4 && Object.keys(value).every((k) => ["type", "sha"].includes(k));
  return false;
}

/**
 * Validates a candidate Mission v1 document. Collects all issues rather than
 * throwing on the first one, so the UI can show a complete list.
 */
export function validateMission(candidate: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!isPlainObject(candidate)) {
    return {
      ok: false,
      issues: [
        {
          path: "",
          code: "field_invalid",
          message: "mission must be a JSON object",
        },
      ],
    };
  }

  const m = candidate;
  const rootKeys = ["schemaVersion", "missionId", "objective", "createdBy", "createdAt", "declaredRiskLevel", "declaredRequiresApproval", "limits", "target", "operations", "metadata", "contentHash"];
  for (const key of Object.keys(m)) if (!rootKeys.includes(key)) issues.push({ path: key, code: "field_unknown", message: "unknown mission property" });

  if (
    typeof m.schemaVersion !== "string" ||
    !(SUPPORTED_MISSION_SCHEMA_VERSIONS as readonly string[]).includes(
      m.schemaVersion,
    )
  ) {
    issues.push({
      path: "schemaVersion",
      code: "schema_version_unsupported",
      message: `schemaVersion must be one of: ${SUPPORTED_MISSION_SCHEMA_VERSIONS.join(", ")}`,
    });
  }

  if (!isWellFormedId(m.missionId)) {
    issues.push({
      path: "missionId",
      code: "field_invalid",
      message: "missionId must match /^[A-Za-z0-9_-]{8,128}$/",
    });
  }

  if (typeof m.objective !== "string" || m.objective.length === 0) {
    issues.push({
      path: "objective",
      code: "field_invalid",
      message: "objective must be a non-empty string",
    });
  } else if (m.objective.length > 500) {
    issues.push({
      path: "objective",
      code: "field_invalid",
      message: "objective must be 500 characters or fewer",
    });
  }

  if (
    typeof m.createdBy !== "string" ||
    !(MISSION_CREATORS as readonly string[]).includes(m.createdBy)
  ) {
    issues.push({
      path: "createdBy",
      code: "field_invalid",
      message: `createdBy must be one of: ${MISSION_CREATORS.join(", ")}`,
    });
  }

  if (!isIsoTimestamp(m.createdAt)) {
    issues.push({
      path: "createdAt",
      code: "field_invalid",
      message: "createdAt must be an ISO 8601 timestamp",
    });
  }

  if (
    typeof m.declaredRiskLevel !== "string" ||
    !(RISK_LEVELS as readonly string[]).includes(m.declaredRiskLevel)
  ) {
    issues.push({
      path: "declaredRiskLevel",
      code: "field_invalid",
      message: `declaredRiskLevel must be one of: ${RISK_LEVELS.join(", ")}`,
    });
  }

  if (typeof m.declaredRequiresApproval !== "boolean") {
    issues.push({
      path: "declaredRequiresApproval",
      code: "field_invalid",
      message: "declaredRequiresApproval must be a boolean",
    });
  }

  if (!isPlainObject(m.limits)) {
    issues.push({ path: "limits", code: "field_invalid", message: "limits must be an object (may be empty)" });
  } else {
    const validLimits: Record<string, number> = { maxSeconds: 1, maxOperations: 1, maxRetries: 0, maxEvidenceBytes: 1024, maxPages: 1, maxConcurrentPages: 1 };
    for (const [key, value] of Object.entries(m.limits)) {
      if (!(key in validLimits)) issues.push({ path: `limits.${key}`, code: "field_unknown", message: "unknown limit property" });
      else if (typeof value !== "number" || !Number.isInteger(value) || value < validLimits[key]) issues.push({ path: `limits.${key}`, code: "field_invalid", message: "limit must be an integer at or above its minimum" });
    }
  }

  validateTarget(m.target, issues);

  if (!Array.isArray(m.operations) || m.operations.length === 0) {
    issues.push({
      path: "operations",
      code: "field_invalid",
      message: "operations must be a non-empty array",
    });
  } else {
    const seen = new Set<string>();
    for (let i = 0; i < m.operations.length; i += 1) {
      const op = m.operations[i];
      if (!validateOperation(op, i, issues)) continue;
      if (!isWellFormedId(op.operationId)) {
        issues.push({ path: `operations[${i}].operationId`, code: "field_invalid", message: "operationId must match /^[A-Za-z0-9_-]{8,128}$/" });
      } else if (seen.has(op.operationId)) {
        issues.push({ path: `operations[${i}].operationId`, code: "conflict", message: `duplicate operationId: ${op.operationId}` });
      } else seen.add(op.operationId);
      if (typeof op.required !== "boolean") issues.push({ path: `operations[${i}].required`, code: "field_invalid", message: "required must be a boolean" });
      if (typeof op.description !== "string" || op.description.length === 0 || op.description.length > 500) {
        issues.push({ path: `operations[${i}].description`, code: "field_invalid", message: "description must be 1–500 characters" });
      }
    }
  }

  validateMetadata(m.metadata, issues);

  if (m.contentHash !== undefined && (typeof m.contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(m.contentHash))) {
    issues.push({ path: "contentHash", code: "field_invalid", message: "contentHash must be sha256 followed by 64 lowercase hex characters" });
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Throws a MissionRunnerError if the candidate is not a valid Mission v1.
 * Useful in code paths that prefer exceptions.
 */
export function assertMissionV1(candidate: unknown): asserts candidate is MissionV1 {
  const result = validateMission(candidate);
  if (!result.ok) {
    throw makeError("schema_invalid", "Mission failed schema validation", {
      details: { issues: result.issues },
    });
  }
}

/**
 * Narrows a validated candidate to MissionV1 and clamps its limits. Callers
 * should validate first.
 */
export function toExecutableMission(candidate: MissionV1): {
  mission: MissionV1;
  limits: MissionLimits;
} {
  const limits = clampMissionLimits(candidate.limits);
  return { mission: candidate, limits };
}

export function isMissionV1(value: unknown): value is MissionV1 {
  return validateMission(value).ok;
}

/** Re-exported for convenience so callers do not need to import from errors.ts. */
export { MissionRunnerError };