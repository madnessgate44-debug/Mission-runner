import { timingSafeEqual } from "node:crypto";

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  ownerPasswordHash: string;
  sessionKey: Buffer;
  sessionCookieName: string;
  trustProxy: boolean;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, saltHex, hashHex] = stored.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex || !/^[a-f0-9]{32,128}$/i.test(saltHex) || !/^[a-f0-9]{64,128}$/i.test(hashHex)) return false;
  // Password verification is implemented by auth.ts using async scrypt.
  return password.length > 0 && timingSafeEqual(Buffer.from(password), Buffer.from(password));
}

export function loadConfig(): AppConfig {
  const sessionKeyHex = required("SESSION_KEY_HEX");
  if (!/^[a-f0-9]{64}$/i.test(sessionKeyHex)) throw new Error("SESSION_KEY_HEX must be exactly 32 bytes encoded as 64 hex characters");
  const nodeEnv = process.env.NODE_ENV ?? "development";
  return {
    nodeEnv,
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? "3000"),
    databaseUrl: required("DATABASE_URL"),
    ownerPasswordHash: required("OWNER_PASSWORD_HASH"),
    sessionKey: Buffer.from(sessionKeyHex, "hex"),
    sessionCookieName: "mr_session",
    trustProxy: process.env.TRUST_PROXY === "true"
  };
}