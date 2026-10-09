import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../dist/app.js";
import { createPasswordHash } from "../dist/auth.js";

function fakeStore() {
  return {
    async migrate() {},
    async create() {},
    async get() { return null; },
    async list() { return []; },
    async approve() { return null; },
    async cancelMission() { return null; },
    async close() {}
  };
}

test("health endpoint is public and mission list requires a session", async () => {
  const app = await buildApp({
    config: {
      nodeEnv: "test", host: "127.0.0.1", port: 3000, databaseUrl: "unused",
      ownerPasswordHash: createPasswordHash("long-test-secret-value"),
      sessionKey: Buffer.alloc(32, 7), sessionCookieName: "mr_session", trustProxy: false, browserWorkerUrl: "", browserWorkerSecret: "", githubWorkerUrl: "", githubWorkerSecret: "", aiToolSecret: "test-ai-tool-secret-with-at-least-32-characters"
    },
    store: fakeStore()
  });
  try {
    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().ok, true);
    const denied = await app.inject({ method: "GET", url: "/missions" });
    assert.equal(denied.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("login returns a CSRF token and establishes an authenticated session", async () => {
  const app = await buildApp({
    config: {
      nodeEnv: "test", host: "127.0.0.1", port: 3000, databaseUrl: "unused",
      ownerPasswordHash: createPasswordHash("long-test-secret-value"),
      sessionKey: Buffer.alloc(32, 8), sessionCookieName: "mr_session", trustProxy: false, browserWorkerUrl: "", browserWorkerSecret: "", githubWorkerUrl: "", githubWorkerSecret: "", aiToolSecret: "test-ai-tool-secret-with-at-least-32-characters"
    },
    store: fakeStore()
  });
  try {
    const response = await app.inject({
      method: "POST", url: "/auth/login",
      payload: { password: "long-test-secret-value" }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(typeof response.json().csrfToken, "string");
    assert.ok(response.headers["set-cookie"]);
    const denied = await app.inject({
      method: "POST", url: "/auth/login", payload: { password: "incorrect-secret" }
    });
    assert.equal(denied.statusCode, 401);
  } finally {
    await app.close();
  }
});
test("AI tool key can use mission APIs but cannot approve a mission", async () => {
  const app = await buildApp({
    config: {
      nodeEnv: "test", host: "127.0.0.1", port: 3000, databaseUrl: "unused",
      ownerPasswordHash: createPasswordHash("long-test-secret-value"),
      sessionKey: Buffer.alloc(32, 9), sessionCookieName: "mr_session", trustProxy: false,
      browserWorkerUrl: "", browserWorkerSecret: "", githubWorkerUrl: "", githubWorkerSecret: "",
      aiToolSecret: "test-ai-tool-secret-with-at-least-32-characters"
    },
    store: fakeStore()
  });
  try {
    const allowed = await app.inject({ method: "GET", url: "/missions", headers: { "x-ai-tool-key": "test-ai-tool-secret-with-at-least-32-characters" } });
    assert.equal(allowed.statusCode, 200);
    const approval = await app.inject({ method: "POST", url: "/missions/example/approve", headers: { "x-ai-tool-key": "test-ai-tool-secret-with-at-least-32-characters" } });
    assert.equal(approval.statusCode, 401);
  } finally {
    await app.close();
  }
});
