/**
 * Idempotency key derivation.
 *
 * Every operation has a stable idempotency key derived from the mission ID, the
 * operation ID, and a canonical hash of the operation's parameters. Retries with
 * the same key must be safe: workers consult a persistent store and, for remote
 * writes, reconcile against the expected remote state before mutating again.
 */

import type { IdempotencyKey, MissionId, OperationId } from "./ids.js";
import { asIdempotencyKey } from "./ids.js";
import type { MissionOperation } from "./operations/index.js";

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace. This is
 * intentionally simple and deterministic. It is not a general JSON canonicalizer
 * (no number normalization beyond JSON.stringify), which is sufficient for our
 * own payloads.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`;
}

/**
 * A synchronous, dependency-free FNV-1a 64-bit-ish hash rendered as hex.
 * This is NOT cryptographic. It is used only to derive a stable, collision-
 * resistant-enough key for idempotency bookkeeping. Cryptographic integrity of
 * evidence uses SHA-256 in the workers.
 */
export function fnv1a64Hex(input: string): string {
  // Two independent 32-bit FNV-1a streams concatenated, to reduce collisions.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  const a = h1.toString(16).padStart(8, "0");
  const b = h2.toString(16).padStart(8, "0");
  return `${a}${b}`;
}

/**
 * Derives an idempotency key for an operation. The key is stable for identical
 * (missionId, operationId, operationBody) triples and different if any of those
 * change. The operation body hashed excludes the operationId itself (which is
 * already part of the key input) to keep semantics clear.
 */
export function deriveIdempotencyKey(
  missionId: MissionId,
  operation: MissionOperation,
): IdempotencyKey {
  const { operationId, ...body } = operation;
  const canonical = canonicalJson(body);
  const hash = fnv1a64Hex(`${missionId}|${operationId}|${canonical}`);
  return asIdempotencyKey(`idem_${hash}`);
}

/**
 * Content hash used for idempotent mission resubmission. Excludes fields that
 * may legitimately vary between submissions of the same logical mission.
 */
export function missionContentHash(input: {
  missionId: MissionId;
  objective: string;
  createdBy: string;
  target: unknown;
  operations: readonly MissionOperation[];
}): string {
  const canonical = canonicalJson({
    missionId: input.missionId,
    objective: input.objective,
    createdBy: input.createdBy,
    target: input.target,
    operations: input.operations,
  });
  return `mch_${fnv1a64Hex(canonical)}`;
}