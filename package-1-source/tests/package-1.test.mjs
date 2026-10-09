import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateMission } from "../shared/dist/validation.js";
import { canonicalJson, missionContentHash } from "../shared/dist/idempotency.js";
import {
  effectiveMissionRisk,
  missionRequiresApproval,
  operationRequiresApproval,
} from "../shared/dist/operations/index.js";

const example = JSON.parse(await readFile(new URL("../shared/schemas/mission.v1.example.json", import.meta.url), "utf8"));
const clone = (value) => structuredClone(value);
const schema = JSON.parse(await readFile(new URL("../shared/schemas/mission.v1.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const schemaValidate = ajv.compile(schema);

test("Mission v1 example passes runtime validation", () => {
  assert.deepEqual(validateMission(example), { ok: true, issues: [] });
  assert.equal(schemaValidate(example), true);
});

test("rejects legacy policy fields and unknown mission properties", () => {
  const candidate = clone(example);
  candidate.riskLevel = candidate.declaredRiskLevel;
  candidate.requiresApproval = candidate.declaredRequiresApproval;
  delete candidate.declaredRiskLevel;
  delete candidate.declaredRequiresApproval;
  assert.equal(validateMission(candidate).ok, false);
  assert.equal(schemaValidate(candidate), false);
  assert.ok(validateMission(candidate).issues.some((issue) => issue.code === "field_unknown"));
});

test("JSON Schema and runtime validator reject irrelevant operation properties", () => {
  const candidate = clone(example);
  candidate.operations[0].body = "not valid for read_file";
  assert.equal(validateMission(candidate).ok, false);
  assert.equal(schemaValidate(candidate), false);
});

test("rejects unknown operation fields and missing operation-specific fields", () => {
  const extra = clone(example);
  extra.operations[0].dangerous = true;
  assert.ok(validateMission(extra).issues.some((issue) => issue.code === "field_unknown"));
  const missing = clone(example);
  delete missing.operations[0].path;
  assert.ok(validateMission(missing).issues.some((issue) => issue.path === "operations[0].path"));
});

test("rejects invalid calendar timestamps and empty mixed targets", () => {
  const date = clone(example);
  date.createdAt = "2026-02-30T12:00:00.000Z";
  assert.ok(validateMission(date).issues.some((issue) => issue.path === "createdAt"));
  const target = clone(example);
  target.target.repos = [];
  assert.ok(validateMission(target).issues.some((issue) => issue.path === "target.repos"));
  assert.equal(schemaValidate(target), false);
});

test("rejects operation counts above effective limits", () => {
  const candidate = clone(example);
  candidate.limits.maxOperations = 2;
  assert.ok(validateMission(candidate).issues.some((issue) => issue.code === "limit_exceeded"));
});

test("rejects operations outside declared mission targets", () => {
  const repoMismatch = clone(example);
  repoMismatch.operations[0].repo = "other-org/other-repo";
  assert.ok(validateMission(repoMismatch).issues.some((issue) => issue.code === "target_scope_violation"));
  const domainMismatch = clone(example);
  domainMismatch.operations[1].url = "https://not-allowed.example/";
  assert.ok(validateMission(domainMismatch).issues.some((issue) => issue.code === "target_scope_violation"));
});

test("requires approval for browser clicks, typing, submissions, and GitHub writes", () => {
  const base = { operationId: "op_test_action_001", required: true, description: "test" };
  assert.equal(operationRequiresApproval({ kind: "browser", op: "click", ...base, selector: "button" }), true);
  assert.equal(operationRequiresApproval({ kind: "browser", op: "type", ...base, selector: "input", text: "x" }), true);
  assert.equal(operationRequiresApproval({ kind: "browser", op: "submit_form", ...base, selector: "form" }), true);
  assert.equal(operationRequiresApproval({ kind: "browser", op: "navigate", ...base, url: "https://example.com" }), false);
  assert.equal(operationRequiresApproval({ kind: "github", op: "put_file", ...base, repo: "org/repo", path: "a.txt", branch: "main", content: "x", commitMessage: "test" }), true);
});

test("effective risk and approval are derived from operations", () => {
  const base = { operationId: "op_test_action_001", required: true, description: "test" };
  const submit = { kind: "browser", op: "submit_form", ...base, selector: "form" };
  assert.equal(effectiveMissionRisk("low", [submit]), "high");
  assert.equal(missionRequiresApproval("low", [submit]), true);
  assert.equal(missionRequiresApproval("low", [{ kind: "browser", op: "navigate", ...base, url: "https://example.com" }], true), true);
  assert.equal(missionRequiresApproval("low", [{ kind: "browser", op: "navigate", ...base, url: "https://example.com" }]), false);
});

test("canonical JSON sorts keys and rejects non-JSON array values and cycles", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.throws(() => canonicalJson([undefined]), /JSON values/);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle), /circular/);
});

test("mission SHA-256 digest binds policy, limits, targets, and operations but ignores the claimed digest", async () => {
  const original = await missionContentHash(example);
  assert.match(original, /^sha256:[a-f0-9]{64}$/);
  assert.equal(await missionContentHash({ ...example, contentHash: "sha256:" + "0".repeat(64) }), original);
  assert.notEqual(await missionContentHash({ ...example, declaredRiskLevel: "high" }), original);
  assert.notEqual(await missionContentHash({ ...example, limits: { ...example.limits, maxSeconds: 121 } }), original);
});
