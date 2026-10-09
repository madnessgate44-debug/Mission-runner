/**
 * Evidence model. Evidence is stored out-of-band; only references travel through
 * the API. Secrets must be redacted by the capturing worker before persistence.
 */

import type { EvidenceId, MissionId, OperationId } from "./ids.js";

export const EVIDENCE_KINDS = [
  "screenshot",
  "dom_snapshot",
  "text_extract",
  "console_log",
  "network_log",
  "file_diff",
  "api_response",
  "note",
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface EvidenceRedaction {
  /** Where the redaction was applied, e.g. "header" or "body". */
  scope: "header" | "body" | "console" | "network" | "other";
  /** The key or pattern that was redacted, e.g. "authorization". */
  key: string;
  /** How many occurrences were removed. */
  count: number;
}

export interface EvidenceRef {
  evidenceId: EvidenceId;
  missionId: MissionId;
  operationId: OperationId;
  kind: EvidenceKind;
  /** ISO 8601 timestamp. */
  createdAt: string;
  contentType: string;
  sizeBytes: number;
  /** Opaque storage reference. Never a raw secret, never a public URL. */
  storageRef: string;
  /** Hex-encoded SHA-256 of the stored bytes. */
  sha256: string;
  /** Optional human-readable label. */
  label?: string;
  /** Redactions applied before persistence. */
  redactions?: EvidenceRedaction[];
}

export interface EvidenceIndex {
  missionId: MissionId;
  items: EvidenceRef[];
  totalBytes: number;
  truncated: boolean;
}