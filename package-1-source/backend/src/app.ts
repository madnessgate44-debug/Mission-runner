import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import secureSession from "@fastify/secure-session";
import { randomUUID } from "node:crypto";
import { assertMissionV1, effectiveMissionRisk, missionRequiresApproval, missionContentHash, type MissionV1, type MissionApproval } from "@mission-runner/shared";
import { verifyPassword } from "./auth.js";
import type { AppConfig } from "./config.js";
import { MissionStore, type StoredMission } from "./store.js";
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
  app.post("/missions/validate", { preHandler: requireAuth }, async (request, reply) => {
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
  app.post("/missions", { preHandler: requireAuth }, async (request, reply) => {
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
  app.get("/missions", { preHandler: requireAuth }, async (request) => {
    const query = request.query as { limit?: string };
    const parsed = Number(query.limit ?? 50);
    const limit = Number.isInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : 50;
    return { missions: (await store.list(request.ownerId!, limit)).map(summarize) };
  });
  app.get("/missions/:missionId", { preHandler: requireAuth }, async (request, reply) => {
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
  app.post("/missions/:missionId/cancel", { preHandler: requireAuth }, async (request, reply) => {
    if (!checkCsrf(request)) return reply.code(403).send({ error: "csrf_invalid" });
    const { missionId } = request.params as { missionId: string };
    const item = await store.get(request.ownerId!, missionId);
    if (!item) return reply.code(404).send({ error: "mission_not_found" });
    if (["succeeded", "failed", "cancelled", "expired"].includes(item.status)) return reply.code(409).send({ error: "mission_terminal" });
    const result = await store.cancelMission(request.ownerId!, missionId);
    if (!result) return reply.code(409).send({ error: "mission_cancel_race" });
    return { missionId, status: result.status };
  });
  app.addHook("onClose", async () => { await store.close(); });
  return app;
  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.ownerId) await reply.code(401).send({ error: "authentication_required" });
  }
  function checkCsrf(request: FastifyRequest): boolean {
    const supplied = request.headers["x-csrf-token"];
    const expected = request.session.get("csrfToken");
    return typeof supplied === "string" && typeof expected === "string" && supplied.length > 0 && supplied === expected;
  }
  function summarize(item: StoredMission) {
    return { missionId: item.mission.missionId, objective: item.mission.objective, status: item.status, contentHash: item.contentHash, effectiveRisk: item.effectiveRisk, approvalRequired: item.approvalRequired, createdAt: item.createdAt, updatedAt: item.updatedAt, approval: item.approval ? { approvalId: item.approval.approvalId, contentHash: item.approval.contentHash, approvedAt: item.approval.approvedAt } : null };
  }
}