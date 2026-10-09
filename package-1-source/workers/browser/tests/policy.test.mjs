import test from "node:test";
import assert from "node:assert/strict";
import { domainMatches } from "../dist/policy.js";

test("domain allowlist requires exact match or explicit subdomain wildcard", () => {
  assert.equal(domainMatches("example.com", "example.com"), true);
  assert.equal(domainMatches("sub.example.com", "*.example.com"), true);
  assert.equal(domainMatches("example.com", "*.example.com"), false);
  assert.equal(domainMatches("example.com.attacker.test", "example.com"), false);
});