/**
 * Branded identifier types.
 *
 * Branding prevents accidentally passing a MissionId where an OperationId is
 * expected. IDs are opaque strings; the concrete format (UUIDv4, ULID) is a
 * generator concern, not a contract concern.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type MissionId = Brand<string, "MissionId">;
export type OperationId = Brand<string, "OperationId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type IdempotencyKey = Brand<string, "IdempotencyKey">;

const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isWellFormedId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function asMissionId(value: string): MissionId {
  if (!isWellFormedId(value)) {
    throw new Error(`Invalid MissionId: ${JSON.stringify(value)}`);
  }
  return value as MissionId;
}

export function asOperationId(value: string): OperationId {
  if (!isWellFormedId(value)) {
    throw new Error(`Invalid OperationId: ${JSON.stringify(value)}`);
  }
  return value as OperationId;
}

export function asEvidenceId(value: string): EvidenceId {
  if (!isWellFormedId(value)) {
    throw new Error(`Invalid EvidenceId: ${JSON.stringify(value)}`);
  }
  return value as EvidenceId;
}

export function asIdempotencyKey(value: string): IdempotencyKey {
  if (!isWellFormedId(value)) {
    throw new Error(`Invalid IdempotencyKey: ${JSON.stringify(value)}`);
  }
  return value as IdempotencyKey;
}

/**
 * Generates a new mission/operation ID. Uses crypto.randomUUID when available,
 * otherwise falls back to a timestamp + random suffix. No external dependency.
 */
export function generateId(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 12);
  return `id_${ts}_${rand}`;
}