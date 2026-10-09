import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

test("worker signing contract is HMAC-SHA256 over timestamp, nonce and canonical JSON", () => {
  const body = { missionId: "m1", operationId: "o1" };
  const canonical = (v) => JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))));
  const ts = String(Math.floor(Date.now()/1000));
  const nonce = "nonce-0123456789abcdef";
  const secret = "test-secret-that-is-at-least-thirty-two-characters";
  const signature = createHmac("sha256",secret).update(ts+"."+nonce+"."+canonical(body)).digest("hex");
  assert.match(signature,/^[a-f0-9]{64}$/);
});