/**
 * Hand-written validators for Mission v1.
 *
 * These validators are intentionally dependency-free so the same code can run
 * in the backend, in workers, and in tests. They do not replace the JSON Schema
 * (shared/schemas/mission.v1.schema.json); the schema is the normative artifact,
 * and these functions are the runtime implementation of it.
 */

import type { MissionV1, MissionTarget, MissionMetadata } from "./mission.js";
import { MISSION_CREATORS, type MissionCreator } from "./mission.js";
import { RISK_LEVELS, type RiskLevel } from "./risk.js";
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
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    /\d{4}-\d{2}-\d{2}T/.test(value)
  );
}

function validateTarget(target: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(target)) {
    issues.push({
      path: "target",
      code: "field_invalid",
      message: "target must be an object",
    });
    return;
  }
  const kind = target.kind;
  if (kind === "github") {
    if (
      !Array.isArray(target.repos) ||
      target.repos.length === 0 ||
      !target.repos.every((r) => typeof r === "string" && r.length > 0)
    ) {
      issues.push({
        path: "target.repos",
        code: "field_invalid",
        message: "target.repos must be a non-empty array of strings",
      });
    }
    return;
  }
  if (kind === "browser") {
    if (
      !Array.isArray(target.domains) ||
      target.domains.length === 0 ||
      !target.domains.every((d) => typeof d === "string" && d.length > 0)
    ) {
      issues.push({
        path: "target.domains",
        code: "field_invalid",
        message: "target.domains must be a non-empty array of strings",
      });
    }
    return;
  }
  if (kind === "mixed") {
    if (!Array.isArray(target.repos)) {
      issues.push({
        path: "target.repos",
        code: "field_invalid",
        message: "target.repos must be an array",
      });
    }
    if (!Array.isArray(target.domains)) {
      issues.push({
        path: "target.domains",
        code: "field_invalid",
        message: "target.domains must be an array",
      });
    }
    return;
  }
  issues.push({
    path: "target.kind",
    code: "field_invalid",
    message: "target.kind must be one of: github, browser, mixed",
  });
}

function validateMetadata(
  metadata: unknown,
  issues: ValidationIssue[],
): void {
  if (metadata === undefined) return;
  if (!isPlainObject(metadata)) {
    issues.push({
      path: "metadata",
      code: "field_invalid",
      message: "metadata must be an object",
    });
    return;
  }
  for (const [key, value] of Object.entries(metadata)) {
    const okType =
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean";
    if (!okType) {
      issues.push({
        path: `metadata.${key}`,
        code: "field_invalid",
        message: "metadata values must be string, number, boolean, or null",
      });
    }
  }
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
    typeof m.riskLevel !== "string" ||
    !(RISK_LEVELS as readonly string[]).includes(m.riskLevel)
  ) {
    issues.push({
      path: "riskLevel",
      code: "field_invalid",
      message: `riskLevel must be one of: ${RISK_LEVELS.join(", ")}`,
    });
  }

  if (typeof m.requiresApproval !== "boolean") {
    issues.push({
      path: "requiresApproval",
      code: "field_invalid",
      message: "requiresApproval must be a boolean",
    });
  }

  if (!isPlainObject(m.limits)) {
    issues.push({
      path: "limits",
      code: "field_invalid",
      message: "limits must be an object (may be empty)",
    });
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
      if (!isMissionOperation(op)) {
        issues.push({
          path: `operations[${i}]`,
          code: "operation_unsupported",
          message: "operation is not a recognized GitHub or browser operation",
        });
        continue;
      }
      if (!isWellFormedId(op.operationId)) {
        issues.push({
          path: `operations[${i}].operationId`,
          code: "field_invalid",
          message: "operationId must match /^[A-Za-z0-9_-]{8,128}$/",
        });
      } else if (seen.has(op.operationId)) {
        issues.push({
          path: `operations[${i}].operationId`,
          code: "conflict",
          message: `duplicate operationId: ${op.operationId}`,
        });
      } else {
        seen.add(op.operationId);
      }
      if (typeof op.required !== "boolean") {
        issues.push({
          path: `operations[${i}].required`,
          code: "field_invalid",
          message: "required must be a boolean",
        });
      }
      if (typeof op.description !== "string" || op.description.length === 0) {
        issues.push({
          path: `operations[${i}].description`,
          code: "field_invalid",
          message: "description must be a non-empty string",
        });
      }
    }
  }

  validateMetadata(m.metadata, issues);

  if (m.contentHash !== undefined && typeof m.contentHash !== "string") {
    issues.push({
      path: "contentHash",
      code: "field_invalid",
      message: "contentHash must be a string when present",
    });
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