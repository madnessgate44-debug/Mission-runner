/**
 * Mission Runner error taxonomy.
 *
 * Errors are structured so that they can travel across process boundaries
 * (backend <-> worker) and be rendered consistently in the UI.
 */

export const ERROR_CODES = [
  // Schema / validation
  "schema_invalid",
  "schema_version_unsupported",
  "field_missing",
  "field_invalid",
  // Policy / authorization
  "unauthorized",
  "forbidden",
  "approval_required",
  "approval_denied",
  "limit_exceeded",
  "domain_not_allowed",
  "repo_not_allowed",
  "insufficient_scope",
  "risk_too_high",
  // Dispatch / transport
  "worker_unavailable",
  "worker_timeout",
  "worker_rejected",
  "network_error",
  // Execution
  "operation_failed",
  "operation_unsupported",
  "rate_limited",
  "target_not_found",
  "conflict",
  "idempotent_replay",
  // Internal
  "internal_error",
  "not_implemented",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface MissionRunnerErrorShape {
  /** Stable machine-readable code. */
  code: ErrorCode;
  /** Human-readable, safe to show in the UI. Must not contain secrets. */
  message: string;
  /** Optional structured details. Must not contain secrets. */
  details?: Record<string, unknown>;
  /** Whether a retry with the same idempotency key may succeed. */
  retryable: boolean;
  /** Optional correlation ID for log lookup. */
  correlationId?: string;
}

export class MissionRunnerError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;
  public readonly retryable: boolean;
  public readonly correlationId?: string;

  constructor(shape: MissionRunnerErrorShape) {
    super(shape.message);
    this.name = "MissionRunnerError";
    this.code = shape.code;
    if (shape.details !== undefined) this.details = shape.details;
    this.retryable = shape.retryable;
    if (shape.correlationId !== undefined) this.correlationId = shape.correlationId;
  }

  toShape(): MissionRunnerErrorShape {
    const shape: MissionRunnerErrorShape = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.details !== undefined) shape.details = this.details;
    if (this.correlationId !== undefined) shape.correlationId = this.correlationId;
    return shape;
  }
}

export function isMissionRunnerError(value: unknown): value is MissionRunnerError {
  return value instanceof MissionRunnerError;
}

const RETRYABLE_CODES: readonly ErrorCode[] = [
  "worker_unavailable",
  "worker_timeout",
  "network_error",
  "rate_limited",
];

export function isRetryableCode(code: ErrorCode): boolean {
  return RETRYABLE_CODES.includes(code);
}

export function makeError(
  code: ErrorCode,
  message: string,
  options: { details?: Record<string, unknown>; correlationId?: string } = {},
): MissionRunnerError {
  const shape: MissionRunnerErrorShape = {
    code,
    message,
    retryable: isRetryableCode(code),
  };
  if (options.details !== undefined) shape.details = options.details;
  if (options.correlationId !== undefined) shape.correlationId = options.correlationId;
  return new MissionRunnerError(shape);
}