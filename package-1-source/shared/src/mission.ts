/**
 * Mission v1 contract.
 *
 * A Mission is a bounded, provider-neutral, versioned document. It is authored
 * by the owner or by an assistant (ChatGPT, Gemini, other) and then validated,
 * approved, and dispatched by the backend.
 */

import type {
  EvidenceId,
  IdempotencyKey,
  MissionId,
  OperationId,
} from "./ids.js";
import type { MissionSchemaVersion } from "./version.js";
import type { MissionStatus, OperationStatus } from "./status.js";
import type { RiskLevel } from "./risk.js";
import type { MissionLimits } from "./limits.js";
import type { MissionRunnerErrorShape } from "./errors.js";
import type { EvidenceRef } from "./evidence.js";
import type { MissionOperation } from "./operations/index.js";

export const MISSION_CREATORS = [
  "owner",
  "assistant:chatgpt",
  "assistant:gemini",
  "assistant:other",
] as const;

export type MissionCreator = (typeof MISSION_CREATORS)[number];

export type MissionTarget =
  | { kind: "github"; repos: string[] }
  | { kind: "browser"; domains: string[] }
  | { kind: "mixed"; repos: string[]; domains: string[] };

export interface MissionMetadata {
  /** Free-form, non-executable annotations. */
  [key: string]: string | number | boolean | null;
}

export interface MissionV1 {
  schemaVersion: MissionSchemaVersion;
  missionId: MissionId;
  objective: string;
  createdBy: MissionCreator;
  createdAt: string; // ISO 8601
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  limits: Partial<MissionLimits>;
  target: MissionTarget;
  operations: MissionOperation[];
  metadata?: MissionMetadata;
  /**
   * Optional client-supplied content hash of the mission body (excluding this
   * field). Used for idempotent resubmission.
   */
  contentHash?: string;
}

export interface OperationResult {
  operationId: OperationId;
  status: OperationStatus;
  /** ISO 8601. */
  startedAt: string;
  finishedAt?: string;
  /** Attempt count including the first attempt. */
  attempts: number;
  idempotencyKey: IdempotencyKey;
  /** Structured, operation-specific output. Never contains secrets. */
  output?: Record<string, unknown>;
  error?: MissionRunnerErrorShape;
  evidenceIds: EvidenceId[];
}

export interface MissionResult {
  missionId: MissionId;
  status: MissionStatus;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  effectiveRisk: RiskLevel;
  limits: MissionLimits;
  operations: OperationResult[];
  evidence: EvidenceRef[];
  error?: MissionRunnerErrorShape;
}

export interface MissionStatusTransition {
  missionId: MissionId;
  from: MissionStatus | null;
  to: MissionStatus;
  /** ISO 8601. */
  at: string;
  /** "system" for automatic transitions, or an owner actor identifier. */
  by: string;
  reason?: string;
}

export interface OperationStatusTransition {
  missionId: MissionId;
  operationId: OperationId;
  from: OperationStatus | null;
  to: OperationStatus;
  at: string;
  by: string;
  reason?: string;
}