/**
 * Mission and operation status finite-state machines.
 *
 * A status transition not present in the allowed set is a hard error. This
 * module is the single source of truth for valid transitions.
 */

export const MISSION_STATUSES = [
  "draft",
  "validated",
  "awaiting_approval",
  "approved",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
] as const;

export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const OPERATION_STATUSES = [
  "pending",
  "dispatched",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
] as const;

export type OperationStatus = (typeof OPERATION_STATUSES)[number];

/**
 * Allowed mission transitions. A mission in a terminal state has no outgoing
 * transitions.
 */
const MISSION_TRANSITIONS: Readonly<Record<MissionStatus, readonly MissionStatus[]>> = {
  draft: ["validated", "cancelled"],
  validated: ["awaiting_approval", "approved", "cancelled", "expired"],
  awaiting_approval: ["approved", "cancelled", "expired"],
  approved: ["running", "cancelled", "expired"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
  expired: [],
};

const OPERATION_TRANSITIONS: Readonly<Record<OperationStatus, readonly OperationStatus[]>> = {
  pending: ["dispatched", "skipped", "cancelled"],
  dispatched: ["running", "failed", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  skipped: [],
  cancelled: [],
};

export const MISSION_TERMINAL_STATUSES: readonly MissionStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
  "expired",
];

export const OPERATION_TERMINAL_STATUSES: readonly OperationStatus[] = [
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
];

export function isMissionTerminal(status: MissionStatus): boolean {
  return MISSION_TERMINAL_STATUSES.includes(status);
}

export function isOperationTerminal(status: OperationStatus): boolean {
  return OPERATION_TERMINAL_STATUSES.includes(status);
}

export function canTransitionMission(
  from: MissionStatus,
  to: MissionStatus,
): boolean {
  return MISSION_TRANSITIONS[from].includes(to);
}

export function canTransitionOperation(
  from: OperationStatus,
  to: OperationStatus,
): boolean {
  return OPERATION_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  public readonly from: string;
  public readonly to: string;
  public readonly kind: "mission" | "operation";
  constructor(kind: "mission" | "operation", from: string, to: string) {
    super(`Invalid ${kind} transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
    this.kind = kind;
    this.from = from;
    this.to = to;
  }
}

export function assertMissionTransition(
  from: MissionStatus,
  to: MissionStatus,
): void {
  if (!canTransitionMission(from, to)) {
    throw new InvalidTransitionError("mission", from, to);
  }
}

export function assertOperationTransition(
  from: OperationStatus,
  to: OperationStatus,
): void {
  if (!canTransitionOperation(from, to)) {
    throw new InvalidTransitionError("operation", from, to);
  }
}