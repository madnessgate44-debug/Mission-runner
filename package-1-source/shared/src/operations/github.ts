/**
 * GitHub operation union (v1).
 *
 * Every GitHub operation has: type, operationId, riskLevel contribution,
 * whether it mutates state, and its typed parameters. The executor in
 * workers/github maps each variant to one or more GitHub REST calls.
 *
 * There is no shell, no git clone, no arbitrary file write outside the repo,
 * and no admin operation in v1.
 */

import type { OperationId } from "../ids.js";
import type { RiskLevel } from "../risk.js";

export interface GitHubOperationBase {
  kind: "github";
  operationId: OperationId;
  /** Whether this operation may be skipped if a prior operation fails. */
  required: boolean;
  /** Human-readable description, shown in the UI and approvals. */
  description: string;
}

export interface GitHubRepoRef {
  /** "owner/repo". */
  repo: string;
}

export type GitHubRef =
  | { type: "branch"; name: string }
  | { type: "tag"; name: string }
  | { type: "commit"; sha: string };

export interface GitHubReadFileOp extends GitHubOperationBase {
  op: "read_file";
  repo: string;
  path: string;
  ref?: GitHubRef;
  /** Encoding returned in the result. "utf8" by default. */
  encoding?: "utf8" | "base64";
}

export interface GitHubListFilesOp extends GitHubOperationBase {
  op: "list_files";
  repo: string;
  path: string;
  ref?: GitHubRef;
}

export interface GitHubListIssuesOp extends GitHubOperationBase {
  op: "list_issues";
  repo: string;
  state?: "open" | "closed" | "all";
  labels?: string[];
  limit?: number;
}

export interface GitHubGetIssueOp extends GitHubOperationBase {
  op: "get_issue";
  repo: string;
  issueNumber: number;
}

export interface GitHubListPRsOp extends GitHubOperationBase {
  op: "list_pull_requests";
  repo: string;
  state?: "open" | "closed" | "all";
  limit?: number;
}

export interface GitHubGetPROp extends GitHubOperationBase {
  op: "get_pull_request";
  repo: string;
  pullNumber: number;
}

export interface GitHubListCommitsOp extends GitHubOperationBase {
  op: "list_commits";
  repo: string;
  ref?: GitHubRef;
  limit?: number;
}

export interface GitHubCreateBranchOp extends GitHubOperationBase {
  op: "create_branch";
  repo: string;
  branch: string;
  fromRef: GitHubRef;
}

export interface GitHubPutFileOp extends GitHubOperationBase {
  op: "put_file";
  repo: string;
  path: string;
  branch: string;
  /** Plain text content. The worker base64-encodes before sending. */
  content: string;
  commitMessage: string;
  /** If provided, the worker requires the file's current SHA to match. */
  expectedSha?: string;
}

export interface GitHubOpenPullRequestOp extends GitHubOperationBase {
  op: "open_pull_request";
  repo: string;
  head: string;
  base: string;
  title: string;
  body?: string;
  draft?: boolean;
}

export interface GitHubCommentOnIssueOp extends GitHubOperationBase {
  op: "comment_on_issue";
  repo: string;
  issueNumber: number;
  body: string;
}

export interface GitHubCommentOnPullRequestOp extends GitHubOperationBase {
  op: "comment_on_pull_request";
  repo: string;
  pullNumber: number;
  body: string;
}

export type GitHubOperation =
  | GitHubReadFileOp
  | GitHubListFilesOp
  | GitHubListIssuesOp
  | GitHubGetIssueOp
  | GitHubListPRsOp
  | GitHubGetPROp
  | GitHubListCommitsOp
  | GitHubCreateBranchOp
  | GitHubPutFileOp
  | GitHubOpenPullRequestOp
  | GitHubCommentOnIssueOp
  | GitHubCommentOnPullRequestOp;

export type GitHubOperationType = GitHubOperation["op"];

/** Operations that mutate remote state and therefore force approval. */
export const GITHUB_WRITE_OPS: readonly GitHubOperationType[] = [
  "create_branch",
  "put_file",
  "open_pull_request",
  "comment_on_issue",
  "comment_on_pull_request",
];

export function isGitHubWriteOp(op: GitHubOperationType): boolean {
  return GITHUB_WRITE_OPS.includes(op);
}

/**
 * Baseline risk contribution per operation type. The mission's effective risk
 * is the max of its declared risk and the max over its operations.
 */
export function githubOperationRisk(op: GitHubOperationType): RiskLevel {
  switch (op) {
    case "read_file":
    case "list_files":
    case "list_issues":
    case "get_issue":
    case "list_pull_requests":
    case "get_pull_request":
    case "list_commits":
      return "low";
    case "create_branch":
    case "comment_on_issue":
    case "comment_on_pull_request":
      return "medium";
    case "put_file":
    case "open_pull_request":
      return "high";
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

export function isGitHubOperation(value: unknown): value is GitHubOperation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { kind?: unknown; op?: unknown };
  if (v.kind !== "github") return false;
  if (typeof v.op !== "string") return false;
  return (
    v.op === "read_file" ||
    v.op === "list_files" ||
    v.op === "list_issues" ||
    v.op === "get_issue" ||
    v.op === "list_pull_requests" ||
    v.op === "get_pull_request" ||
    v.op === "list_commits" ||
    v.op === "create_branch" ||
    v.op === "put_file" ||
    v.op === "open_pull_request" ||
    v.op === "comment_on_issue" ||
    v.op === "comment_on_pull_request"
  );
}