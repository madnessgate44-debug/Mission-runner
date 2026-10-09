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
import type { MissionV1 } from "./mission.js";

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace. This is
 * intentionally simple and deterministic. It is not a general JSON canonicalizer
 * (no number normalization beyond JSON.stringify), which is sufficient for our
 * own payloads.
 */
export function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError("Canonical JSON accepts only JSON values");
  if (ancestors.has(value)) throw new TypeError("Canonical JSON rejects circular references");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalJson(item, ancestors)).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item, ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
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
  const hash = fnv1a64Hex(canonicalJson([missionId, operationId, canonical]));
  return asIdempotencyKey(`idem_${hash}`);
}

/**
 * Cryptographic digest for approval binding. Includes every execution-relevant
 * field and excludes only the claimed digest itself. The server must calculate
 * this from its validated immutable mission and store it in the approval record.
 */
export async function missionContentHash(input: MissionV1): Promise<`sha256:${string}`> {
  const executionPayload = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "contentHash"));
  const canonical = canonicalJson(executionPayload);
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}
