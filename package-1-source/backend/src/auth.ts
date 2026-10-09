import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function createPasswordHash(secret: string): string {
  if (secret.length < 12) throw new Error("Secret must be at least 12 characters");
  const salt = randomBytes(16);
  const key = scryptSync(secret, salt, 64);
  return "scrypt$" + salt.toString("hex") + "$" + key.toString("hex");
}

export function verifyPassword(secret: string, encoded: string): boolean {
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const saltHex = parts[1] ?? "";
  const keyHex = parts[2] ?? "";
  if (!/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(keyHex)) return false;
  const actual = scryptSync(secret, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
