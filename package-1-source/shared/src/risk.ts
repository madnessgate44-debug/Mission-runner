/**
 * Risk levels and approval policy.
 *
 * Effective risk is computed server-side from the declared risk and operation
 * risks. Client declarations are hints, never authorization decisions.
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
  /** Whether browser clicks force approval (they may activate consequential UI). */
  requireApprovalForBrowserClicks: boolean;
  /** Whether browser typing forces approval (it may trigger live app behavior). */
  requireApprovalForBrowserTyping: boolean;
  /** Whether any browser form submission forces approval. */
  requireApprovalForBrowserSubmits: boolean;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  requireApprovalAtOrAbove: "high",
  requireApprovalForGitHubWrites: true,
  requireApprovalForBrowserClicks: true,
  requireApprovalForBrowserTyping: true,
  requireApprovalForBrowserSubmits: true,
};