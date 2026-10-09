/**
 * Browser operation union (v1).
 *
 * The browser worker runs Playwright. Operations are deliberately small and
 * composable. There is no `eval` operation, no arbitrary JS execution, and no
 * file upload to arbitrary origins in v1.
 */

import type { OperationId } from "../ids.js";
import type { RiskLevel } from "../risk.js";

export interface BrowserOperationBase {
  kind: "browser";
  operationId: OperationId;
  required: boolean;
  description: string;
}

export interface BrowserNavigateOp extends BrowserOperationBase {
  op: "navigate";
  url: string;
  /** Wait until "load" | "domcontentloaded" | "networkidle". Default "load". */
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  /** Milliseconds to wait after navigation. Default 0. */
  settleMs?: number;
}

export interface BrowserScreenshotOp extends BrowserOperationBase {
  op: "screenshot";
  /** Optional label; used in evidence. */
  label?: string;
  fullPage?: boolean;
}

export interface BrowserExtractTextOp extends BrowserOperationBase {
  op: "extract_text";
  /** CSS selector. If omitted, extracts the whole body's innerText. */
  selector?: string;
  /** Optional attribute to read instead of text content. */
  attribute?: string;
  /** Max characters to capture. Clamped by mission limits. */
  maxChars?: number;
}

export interface BrowserClickOp extends BrowserOperationBase {
  op: "click";
  selector: string;
  /** Milliseconds to wait for the element to appear. Default 5000. */
  timeoutMs?: number;
}

export interface BrowserTypeOp extends BrowserOperationBase {
  op: "type";
  selector: string;
  text: string;
  /** Clear the field before typing. Default true. */
  clear?: boolean;
  timeoutMs?: number;
}

export interface BrowserWaitForSelectorOp extends BrowserOperationBase {
  op: "wait_for_selector";
  selector: string;
  state?: "attached" | "detached" | "visible" | "hidden";
  timeoutMs?: number;
}

export interface BrowserSubmitFormOp extends BrowserOperationBase {
  op: "submit_form";
  selector: string;
  timeoutMs?: number;
}

export interface BrowserAssertTextOp extends BrowserOperationBase {
  op: "assert_text";
  selector: string;
  /** Substring that must be present. */
  contains: string;
  timeoutMs?: number;
}

export interface BrowserGetUrlOp extends BrowserOperationBase {
  op: "get_url";
}

export interface BrowserGetTitleOp extends BrowserOperationBase {
  op: "get_title";
}

export type BrowserOperation =
  | BrowserNavigateOp
  | BrowserScreenshotOp
  | BrowserExtractTextOp
  | BrowserClickOp
  | BrowserTypeOp
  | BrowserWaitForSelectorOp
  | BrowserSubmitFormOp
  | BrowserAssertTextOp
  | BrowserGetUrlOp
  | BrowserGetTitleOp;

export type BrowserOperationType = BrowserOperation["op"];

/**
 * Operations that involve submitting data to a remote site. These force
 * approval by policy when they submit a form.
 */
export const BROWSER_SUBMIT_OPS: readonly BrowserOperationType[] = [
  "submit_form",
];

export function isBrowserSubmitOp(op: BrowserOperationType): boolean {
  return BROWSER_SUBMIT_OPS.includes(op);
}

export function browserOperationRisk(op: BrowserOperationType): RiskLevel {
  switch (op) {
    case "navigate":
    case "screenshot":
    case "extract_text":
    case "get_url":
    case "get_title":
    case "wait_for_selector":
      return "low";
    case "click":
    case "type":
    case "assert_text":
      return "medium";
    case "submit_form":
      return "high";
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

export function isBrowserOperation(value: unknown): value is BrowserOperation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { kind?: unknown; op?: unknown };
  if (v.kind !== "browser") return false;
  if (typeof v.op !== "string") return false;
  return (
    v.op === "navigate" ||
    v.op === "screenshot" ||
    v.op === "extract_text" ||
    v.op === "click" ||
    v.op === "type" ||
    v.op === "wait_for_selector" ||
    v.op === "submit_form" ||
    v.op === "assert_text" ||
    v.op === "get_url" ||
    v.op === "get_title"
  );
}