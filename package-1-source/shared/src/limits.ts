/**
 * Hard server-side caps. Missions declare their own `limits`, but those values
 * are clamped to these caps before dispatch. A mission can never raise a cap.
 */

export interface MissionLimits {
  /** Max wall-clock seconds for the whole mission. */
  maxSeconds: number;
  /** Max number of operations in the mission. */
  maxOperations: number;
  /** Max retries per operation (with the same idempotency key). */
  maxRetries: number;
  /** Max bytes of evidence captured across the mission. */
  maxEvidenceBytes: number;
  /** Browser-only: max pages visited in a single mission. */
  maxPages: number;
  /** Browser-only: max concurrent pages (workers may enforce 1 regardless). */
  maxConcurrentPages: number;
}

export const DEFAULT_MISSION_LIMITS: MissionLimits = {
  maxSeconds: 300,
  maxOperations: 20,
  maxRetries: 2,
  maxEvidenceBytes: 25 * 1024 * 1024, // 25 MiB
  maxPages: 5,
  maxConcurrentPages: 1,
};

/**
 * Hard caps. These are the absolute maxima that a mission can be clamped to.
 * They are intentionally conservative.
 */
export const HARD_MISSION_LIMITS: MissionLimits = {
  maxSeconds: 900,
  maxOperations: 50,
  maxRetries: 3,
  maxEvidenceBytes: 100 * 1024 * 1024, // 100 MiB
  maxPages: 20,
  maxConcurrentPages: 2,
};

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const v = Math.trunc(value);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * Clamps requested limits to the hard caps. Any missing field falls back to the
 * default for that field. This is the only function callers should use to
 * resolve effective limits.
 */
export function clampMissionLimits(
  requested: Partial<MissionLimits> | undefined,
): MissionLimits {
  const r = requested ?? {};
  return {
    maxSeconds: clampInt(
      r.maxSeconds ?? DEFAULT_MISSION_LIMITS.maxSeconds,
      1,
      HARD_MISSION_LIMITS.maxSeconds,
    ),
    maxOperations: clampInt(
      r.maxOperations ?? DEFAULT_MISSION_LIMITS.maxOperations,
      1,
      HARD_MISSION_LIMITS.maxOperations,
    ),
    maxRetries: clampInt(
      r.maxRetries ?? DEFAULT_MISSION_LIMITS.maxRetries,
      0,
      HARD_MISSION_LIMITS.maxRetries,
    ),
    maxEvidenceBytes: clampInt(
      r.maxEvidenceBytes ?? DEFAULT_MISSION_LIMITS.maxEvidenceBytes,
      1024,
      HARD_MISSION_LIMITS.maxEvidenceBytes,
    ),
    maxPages: clampInt(
      r.maxPages ?? DEFAULT_MISSION_LIMITS.maxPages,
      1,
      HARD_MISSION_LIMITS.maxPages,
    ),
    maxConcurrentPages: clampInt(
      r.maxConcurrentPages ?? DEFAULT_MISSION_LIMITS.maxConcurrentPages,
      1,
      HARD_MISSION_LIMITS.maxConcurrentPages,
    ),
  };
}