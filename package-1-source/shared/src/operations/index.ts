import type { GitHubOperation } from "./github.js";
import { isGitHubOperation } from "./github.js";
import type { BrowserOperation } from "./browser.js";
import { isBrowserOperation } from "./browser.js";
import type { RiskLevel } from "../risk.js";
import { maxRisk } from "../risk.js";
import {
  githubOperationRisk,
  isGitHubWriteOp,
} from "./github.js";
import {
  browserOperationRisk,
  isBrowserSubmitOp,
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

export function operationRequiresApproval(op: MissionOperation): boolean {
  if (op.kind === "github") return isGitHubWriteOp(op.op);
  return isBrowserSubmitOp(op.op);
}