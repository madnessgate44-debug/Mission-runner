import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import secureSession from "@fastify/secure-session";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { assertMissionV1, canonicalJson, effectiveMissionRisk, missionRequiresApproval, missionContentHash, type MissionV1, type MissionApproval } from "@mission-runner/shared";
import { verifyPassword } from "./auth.js";
import type { AppConfig } from "./config.js";
import { MissionStore, type StoredMission } from "./store.js";
declare module "@fastify/secure-session" {
  interface SessionData {
    ownerId: string;
    csrfToken: string;
  }
}

declare module "fastify" { interface FastifyRequest { ownerId: string | null; } }
export interface AppOptions { config: AppConfig; store?: MissionStore; }
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const store = options.store ?? new MissionStore(config.databaseUrl);
  const app = Fastify({ logger: true, trustProxy: config.trustProxy, bodyLimit: 1024 * 1024 });
  await app.register(helmet, { contentSecurityPolicy: true });
  await app.register(rateLimit, { max: 30, timeWindow: "1 minute" });
  await app.register(secureSession, { key: config.sessionKey, cookieName: config.sessionCookieName, cookie: { path: "/", httpOnly: true, sameSite: "lax", secure: config.nodeEnv === "production" } });
  app.decorateRequest("ownerId", null);
  app.addHook("preHandler", async (request) => {
    const ownerId = request.session.get("ownerId");
    request.ownerId = typeof ownerId === "string" ? ownerId : null;
  });
  app.get("/health", async () => ({ ok: true, service: "mission-runner-backend" }));
  app.post("/auth/login", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = request.body as { password?: unknown } | null;
    if (!body || typeof body.password !== "string" || body.password.length > 1024) return reply.code(400).send({ error: "invalid_request" });
    if (!(await verifyPassword(body.password, config.ownerPasswordHash))) return reply.code(401).send({ error: "invalid_credentials" });
    request.session.set("ownerId", "owner");
    request.session.set("csrfToken", randomUUID());
    return reply.send({ ok: true, csrfToken: request.session.get("csrfToken") });
  });
  app.post("/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    if (!checkCsrf(request)) return reply.code(403).send({ error: "csrf_invalid" });
    request.session.delete();
    return reply.send({ ok: true });
  });
  app.get("/auth/csrf", { preHandler: requireAuth }, async (request) => ({ csrfToken: request.session.get("csrfToken") }));
  app.post("/missions/validate", { preHandler: requireAuthOrTool }, async (request, reply) => {
    try {
      assertMissionV1(request.body);
      const mission = request.body as MissionV1;
      const contentHash = await missionContentHash(mission);
      const effectiveRisk = effectiveMissionRisk(mission.declaredRiskLevel, mission.operations);
      const approvalRequired = missionRequiresApproval(mission.declaredRiskLevel, mission.operations, mission.declaredRequiresApproval);
      return { valid: true, missionId: mission.missionId, contentHash, effectiveRisk, approvalRequired };
    } catch (error) {
      const e = error as Error & { details?: unknown };
      return reply.code(400).send({ error: "mission_invalid", message: e.message, details: e.details ?? null });
    }
  });
  app.post("/missions", { preHandler: requireAuthOrTool }, async (request, reply) => {
    try {
      assertMissionV1(request.body);
      const mission = request.body as MissionV1;
      const contentHash = await missionContentHash(mission);
      if (mission.contentHash && mission.contentHash !== contentHash) return reply.code(409).send({ error: "content_hash_mismatch" });
      const effectiveRisk = effectiveMissionRisk(mission.declaredRiskLevel, mission.operations);
      const approvalRequired = missionRequiresApproval(mission.declaredRiskLevel, mission.operations, mission.declaredRequiresApproval);
      const now = new Date().toISOString();
      const item: StoredMission = { mission: { ...mission, contentHash }, contentHash, effectiveRisk, approvalRequired, status: approvalRequired ? "awaiting_approval" : "validated", createdAt: now, updatedAt: now };
      try { await store.create(request.ownerId!, item); }
      catch (error) { if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "mission_id_conflict" }); throw error; }
      return reply.code(201).send({ missionId: mission.missionId, status: item.status, contentHash, effectiveRisk, approvalRequired });
    } catch (error) {
      const e = error as Error & { details?: unknown };
      return reply.code(400).send({ error: "mission_invalid", message: e.message, details: e.details ?? null });
    }
  });
  app.get("/missions", { preHandler: requireAuthOrTool }, async (request) => {
    const query = request.query as { limit?: string };
    const parsed = Number(query.limit ?? 50);
    const limit = Number.isInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : 50;
    return { missions: (await store.list(request.ownerId!, limit)).map(summarize) };
  });
  app.get("/missions/:missionId", { preHandler: requireAuthOrTool }, async (request, reply) => {
    const { missionId } = request.params as { missionId: string };
    const item = await store.get(request.ownerId!, missionId);
    if (!item) return reply.code(404).send({ error: "mission_not_found" });
    return summarize(item);
  });
  app.post("/missions/:missionId/approve", { preHandler: requireAuth }, async (request, reply) => {
    if (!checkCsrf(request)) return reply.code(403).send({ error: "csrf_invalid" });
    const { missionId } = request.params as { missionId: string };
    const item = await store.get(request.ownerId!, missionId);
    if (!item) return reply.code(404).send({ error: "mission_not_found" });
    if (item.status !== "awaiting_approval") return reply.code(409).send({ error: "approval_not_required_or_invalid_state" });
    const currentHash = await missionContentHash(item.mission);
    if (currentHash !== item.contentHash) return reply.code(409).send({ error: "content_changed_revalidate" });
    const approval: MissionApproval = { approvalId: randomUUID(), missionId: item.mission.missionId, contentHash: item.contentHash, approvedAt: new Date().toISOString(), approvedBy: request.ownerId! };
    const updated = await store.approve(request.ownerId!, missionId, approval);
    if (!updated) return reply.code(409).send({ error: "approval_race_or_stale_hash" });
    return { missionId, status: updated.status, approval: { approvalId: approval.approvalId, contentHash: approval.contentHash, approvedAt: approval.approvedAt } };
  });
  app.post("/missions/:missionId/cancel", { preHandler: requireAuthOrTool }, async (request, reply) => {
    if (!checkCsrfOrTool(request)) return reply.code(403).send({ error: "csrf_invalid" });
    const { missionId } = request.params as { missionId: string };
    const item = await store.get(request.ownerId ?? "owner", missionId);
    if (!item) return reply.code(404).send({ error: "mission_not_found" });
    if (["succeeded", "failed", "cancelled", "expired"].includes(item.status)) return reply.code(409).send({ error: "mission_terminal" });
    const result = await store.cancelMission(request.ownerId ?? "owner", missionId);
    if (!result) return reply.code(409).send({ error: "mission_cancel_race" });
    return { missionId, status: result.status };
  });


  app.post("/missions/:missionId/execute", { preHandler: requireAuthOrTool }, async (request, reply) => {
    if (!checkCsrfOrTool(request)) return reply.code(403).send({ error: "csrf_invalid" });
    const { missionId } = request.params as { missionId: string };
    const item = await store.get(request.ownerId ?? "owner", missionId);
    if (!item) return reply.code(404).send({ error: "mission_not_found" });
    if (!["validated", "approved"].includes(item.status)) return reply.code(409).send({ error: "mission_not_executable", status: item.status });
    const digest = await missionContentHash(item.mission);
    if (digest !== item.contentHash) return reply.code(409).send({ error: "content_changed_revalidate" });
    if (item.approvalRequired && (!item.approval || item.approval.contentHash !== digest)) return reply.code(403).send({ error: "approval_required" });
    const started = await store.startExecution(request.ownerId ?? "owner", missionId, digest);
    if (!started) return reply.code(409).send({ error: "mission_state_changed_retry" });
    const operationResults: Array<Record<string, unknown>> = [];
    let requiredFailure = false;
    for (const operation of item.mission.operations) {
      const latest = await store.get(request.ownerId ?? "owner", missionId);
      if (!latest || latest.status === "cancelled") {
        operationResults.push({ operationId: operation.operationId, status: "not_run", reason: "mission_cancelled" });
        break;
      }
      if (requiredFailure) {
        operationResults.push({ operationId: operation.operationId, status: "not_run", reason: "prior_required_operation_failed" });
        continue;
      }
      try {
        const workerUrl = operation.kind === "github" ? config.githubWorkerUrl : config.browserWorkerUrl;
        const workerSecret = operation.kind === "github" ? config.githubWorkerSecret : config.browserWorkerSecret;
        if (!workerUrl || workerSecret.length < 32) throw new Error(operation.kind + "_worker_not_configured");
        const body = { mission: item.mission, operation, contentHash: digest, ...(item.approval ? { approval: item.approval } : {}) };
        const timestamp = String(Math.floor(Date.now() / 1000));
        const nonce = randomUUID();
        const signature = createHmac("sha256", workerSecret).update(timestamp + "." + nonce + "." + canonicalJson(body)).digest("hex");
        const response = await fetch(new URL("execute", workerUrl.endsWith("/") ? workerUrl : workerUrl + "/"), {
          method: "POST",
          headers: { "content-type": "application/json", "x-worker-timestamp": timestamp, "x-worker-nonce": nonce, "x-worker-signature": signature },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000)
        });
        const payload = await response.json().catch(() => ({ error: "worker_invalid_response" })) as Record<string, unknown>;
        if (!response.ok) throw new Error(String(payload.message ?? payload.error ?? "worker_request_failed"));
        operationResults.push({ operationId: operation.operationId, kind: operation.kind, op: operation.op, status: "succeeded", result: payload.result ?? null });
      } catch (error) {
        operationResults.push({ operationId: operation.operationId, kind: operation.kind, op: operation.op, status: "failed", error: (error as Error).message });
        if (operation.required) requiredFailure = true;
      }
    }
    const finalStatus = requiredFailure ? "failed" : "succeeded";
    const completed = await store.finishExecution(request.ownerId ?? "owner", missionId, finalStatus, operationResults);
    if (!completed) {
      const current = await store.get(request.ownerId ?? "owner", missionId);
      return reply.code(409).send({ error: "mission_state_changed_during_execution", status: current?.status ?? "unknown", operations: operationResults });
    }
    return { missionId, status: completed.status, contentHash: completed.contentHash, operations: operationResults };
  });

  async function callBrowserWorker(path: string, body: unknown): Promise<Response> {
    if (!config.browserWorkerUrl || config.browserWorkerSecret.length < 32) throw new Error("browser_worker_not_configured");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomUUID();
    const signature = createHmac("sha256", config.browserWorkerSecret)
      .update(timestamp + "." + nonce + "." + canonicalJson(body))
      .digest("hex");
    return fetch(new URL(path, config.browserWorkerUrl.endsWith("/") ? config.browserWorkerUrl : config.browserWorkerUrl + "/"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-timestamp": timestamp, "x-worker-nonce": nonce, "x-worker-signature": signature },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000)
    });
  }

  app.get("/browser/inspect", { preHandler: requireAuthOrTool }, async (_request, reply) => {
    try {
      const response = await callBrowserWorker("session/inspect", {});
      const payload = await response.json().catch(() => null) as { url?: string; title?: string; text?: string } | null;
      if (!response.ok || !payload) return reply.code(response.status || 502).send({ error: "browser_worker_error" });
      return { url: payload.url ?? "", title: payload.title ?? "", text: redactSensitiveText(payload.text ?? "") };
    } catch (error) {
      requestLog(error);
      return reply.code(503).send({ error: "browser_worker_unavailable" });
    }
  });

  app.get("/browser/screenshot", { preHandler: requireAuth }, async (_request, reply) => {
    try {
      const response = await callBrowserWorker("session/screenshot", {});
      if (!response.ok) return reply.code(response.status).send({ error: "browser_worker_error" });
      return reply.type("image/png").header("cache-control", "no-store").send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      requestLog(error);
      return reply.code(503).send({ error: "browser_worker_unavailable" });
    }
  });

  app.post("/browser/navigate", { preHandler: requireAuth }, async (request, reply) => {
    if (!checkCsrf(request)) return reply.code(403).send({ error: "csrf_invalid" });
    const body = request.body as { url?: unknown } | null;
    if (!body || typeof body.url !== "string" || body.url.length > 2048) return reply.code(400).send({ error: "url_invalid" });
    try {
      const response = await callBrowserWorker("session/navigate", { url: body.url });
      const payload = await response.json().catch(() => ({ error: "invalid_worker_response" }));
      return reply.code(response.status).send(payload);
    } catch (error) {
      requestLog(error);
      return reply.code(503).send({ error: "browser_worker_unavailable" });
    }
  });

  app.post("/browser/click", { preHandler: requireAuth }, async (request, reply) => {
    if (!checkCsrf(request)) return reply.code(403).send({ error: "csrf_invalid" });
    const body = request.body as { x?: unknown; y?: unknown } | null;
    if (!body || typeof body.x !== "number" || typeof body.y !== "number") return reply.code(400).send({ error: "coordinates_invalid" });
    try {
      const response = await callBrowserWorker("session/click", { x: body.x, y: body.y });
      return reply.code(response.status).send(await response.json().catch(() => ({ error: "invalid_worker_response" })));
    } catch (error) {
      requestLog(error);
      return reply.code(503).send({ error: "browser_worker_unavailable" });
    }
  });

  app.post("/browser/type", { preHandler: requireAuth }, async (request, reply) => {
    if (!checkCsrf(request)) return reply.code(403).send({ error: "csrf_invalid" });
    const body = request.body as { text?: unknown } | null;
    if (!body || typeof body.text !== "string" || body.text.length > 4000) return reply.code(400).send({ error: "text_invalid" });
    try {
      const response = await callBrowserWorker("session/type", { text: body.text });
      return reply.code(response.status).send(await response.json().catch(() => ({ error: "invalid_worker_response" })));
    } catch (error) {
      requestLog(error);
      return reply.code(503).send({ error: "browser_worker_unavailable" });
    }
  });

  app.post("/browser/press", { preHandler: requireAuth }, async (request, reply) => {
    if (!checkCsrf(request)) return reply.code(403).send({ error: "csrf_invalid" });
    const body = request.body as { key?: unknown } | null;
    if (!body || typeof body.key !== "string") return reply.code(400).send({ error: "key_invalid" });
    try {
      const response = await callBrowserWorker("session/press", { key: body.key });
      return reply.code(response.status).send(await response.json().catch(() => ({ error: "invalid_worker_response" })));
    } catch (error) {
      requestLog(error);
      return reply.code(503).send({ error: "browser_worker_unavailable" });
    }
  });

  app.post("/browser/back", { preHandler: requireAuth }, async (request, reply) => {
    if (!checkCsrf(request)) return reply.code(403).send({ error: "csrf_invalid" });
    try {
      const response = await callBrowserWorker("session/back", {});
      return reply.code(response.status).send(await response.json().catch(() => ({ error: "invalid_worker_response" })));
    } catch (error) {
      requestLog(error);
      return reply.code(503).send({ error: "browser_worker_unavailable" });
    }
  });

  app.addHook("onClose", async () => { await store.close(); });
  return app;
  function requestLog(error: unknown): void { app.log.warn({ error: error instanceof Error ? error.message : "unknown" }, "Worker proxy request failed"); }
  function isAiTool(request: FastifyRequest): boolean {
    const supplied = request.headers["x-ai-tool-key"];
    const expected = config.aiToolSecret;
    if (typeof supplied !== "string" || expected.length < 32) return false;
    const left = Buffer.from(supplied);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }
  function checkCsrfOrTool(request: FastifyRequest): boolean { return isAiTool(request) || checkCsrf(request); }
  function redactSensitiveText(value: string): string {
    return value
      .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g, "[REDACTED_GITHUB_TOKEN]")
      .replace(/\\bAKIA[0-9A-Z]{16}\\b/g, "[REDACTED_AWS_KEY]")
      .replace(/\\bsk-[A-Za-z0-9_-]{20,}\\b/g, "[REDACTED_API_KEY]")
      .replace(/\\bBearer\\s+[A-Za-z0-9._~+\\/-]+=*/gi, "Bearer [REDACTED]")
      .replace(/(password|passwd|secret|api[_-]?key)\\s*[:=]\\s*[^\\s&]+/gi, "$1=[REDACTED]")
      .slice(0, 8000);
  }
  async function requireAuthOrTool(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.ownerId && !isAiTool(request)) await reply.code(401).send({ error: "authentication_required" });
  }
  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.ownerId) await reply.code(401).send({ error: "authentication_required" });
  }
  function checkCsrf(request: FastifyRequest): boolean {
    const supplied = request.headers["x-csrf-token"];
    const expected = request.session.get("csrfToken");
    return typeof supplied === "string" && typeof expected === "string" && supplied.length > 0 && supplied === expected;
  }
  function summarize(item: StoredMission) {
    return { missionId: item.mission.missionId, objective: item.mission.objective, status: item.status, contentHash: item.contentHash, effectiveRisk: item.effectiveRisk, approvalRequired: item.approvalRequired, createdAt: item.createdAt, updatedAt: item.updatedAt, approval: item.approval ? { approvalId: item.approval.approvalId, contentHash: item.approval.contentHash, approvedAt: item.approval.approvedAt } : null, result: item.result ?? null };
  }
}