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
export function loadConfig(): AppConfig {
  const sessionKeyHex = required("SESSION_KEY_HEX");
  if (!/^[a-f0-9]{64}$/i.test(sessionKeyHex)) throw new Error("SESSION_KEY_HEX must be 32 bytes encoded as 64 hex characters");
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const port = Number(process.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
  return {
    nodeEnv,
    host: process.env.HOST ?? "127.0.0.1",
    port,
    databaseUrl: required("DATABASE_URL"),
    ownerPasswordHash: required("OWNER_PASSWORD_HASH"),
    sessionKey: Buffer.from(sessionKeyHex, "hex"),
    sessionCookieName: "mr_session",
    trustProxy: process.env.TRUST_PROXY === "true"
  };
}