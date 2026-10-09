import type { GitHubOperation } from "./github.js";
import { isGitHubOperation } from "./github.js";
import type { BrowserOperation } from "./browser.js";
import { isBrowserOperation } from "./browser.js";
import type { ApprovalPolicy, RiskLevel } from "../risk.js";
import { DEFAULT_APPROVAL_POLICY, maxRisk, riskAtLeast } from "../risk.js";
import {
  githubOperationRisk,
  isGitHubWriteOp,
} from "./github.js";
import {
  browserOperationRisk,
  isBrowserApprovalOp,
} from "./browser.js";

export * from "./github.js";
export * from "./browser.js";

export type MissionOperation = GitHubOperation | BrowserOperation;

export function isMissionOperation(value: unknown): value is MissionOperation {
  return isGitHubOperation(value) || isBrowserOperation(value);
}

export function operationRisk(op: MissionOperation): RiskLevel {
  if (op.kind === "github") return githubOperationRisk(op.op);
  return browserOperationRisk(op.op);
}

export function aggregateOperationRisk(
  operations: readonly MissionOperation[],
): RiskLevel {
  let risk: RiskLevel = "low";
  for (const op of operations) {
    risk = maxRisk(risk, operationRisk(op));
  }
  return risk;
}

export function operationRequiresApproval(
  op: MissionOperation,
  policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY,
): boolean {
  if (op.kind === "github") return policy.requireApprovalForGitHubWrites && isGitHubWriteOp(op.op);
  if (op.op === "click") return policy.requireApprovalForBrowserClicks;
  if (op.op === "type") return policy.requireApprovalForBrowserTyping;
  if (op.op === "submit_form") return policy.requireApprovalForBrowserSubmits;
  return false;
}

/** Computes effective risk from untrusted declaration plus operation risk. */
export function effectiveMissionRisk(
  declaredRisk: RiskLevel,
  operations: readonly MissionOperation[],
): RiskLevel {
  return maxRisk(declaredRisk, aggregateOperationRisk(operations));
}

/** High-risk missions always require approval regardless of author declarations. */
export function missionRequiresApproval(
  declaredRisk: RiskLevel,
  operations: readonly MissionOperation[],
  policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY,
): boolean {
  return riskAtLeast(effectiveMissionRisk(declaredRisk, operations), policy.requireApprovalAtOrAbove) ||
    operations.some((operation) => operationRequiresApproval(operation, policy));
}