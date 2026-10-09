import test from "node:test";
import assert from "node:assert/strict";
import { bearerTokenMatches } from "../dist/auth.js";

test("MCP gateway accepts only an exact bearer token", () => {
  const token = "test-token-value-with-more-than-32-characters";
  assert.equal(bearerTokenMatches("Bearer " + token, token), true);
  assert.equal(bearerTokenMatches("Bearer wrong-token-value-with-more-than-32", token), false);
  assert.equal(bearerTokenMatches(token, token), false);
  assert.equal(bearerTokenMatches("Bearer " + token, "short"), false);
});