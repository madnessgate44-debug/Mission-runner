/**
 * Risk levels and approval policy.
 *
 * The effective risk of a mission is the max of the declared risk and the risk
 * computed from its operations. Approval is forced for high-risk missions and
 * for any GitHub write operation.
 */

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export function riskAtLeast(a: RiskLevel, b: RiskLevel): boolean {
  return RISK_ORDER[a] >= RISK_ORDER[b];
}

export interface ApprovalPolicy {
  /** Risk level at or above which approval is always required. */
  requireApprovalAtOrAbove: RiskLevel;
  /** Whether any GitHub write operation forces approval. */
  requireApprovalForGitHubWrites: boolean;
  /** Whether any browser form submission forces approval. */
  requireApprovalForBrowserSubmits: boolean;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  requireApprovalAtOrAbove: "high",
  requireApprovalForGitHubWrites: true,
  requireApprovalForBrowserSubmits: true,
};