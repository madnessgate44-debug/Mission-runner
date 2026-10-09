import test from "node:test";
import assert from "node:assert/strict";
import { createPasswordHash, verifyPassword } from "../dist/auth.js";

test("owner credential hashes verify without storing the original secret", () => {
  const secret = "a-long-test-secret-value";
  const encoded = createPasswordHash(secret);
  assert.match(encoded, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(verifyPassword(secret, encoded), true);
  assert.equal(verifyPassword("wrong-secret", encoded), false);
  assert.equal(encoded.includes(secret), false);
});

test("credential hash creation rejects short secrets", () => {
  assert.throws(() => createPasswordHash("short"), /at least 12 characters/);
});