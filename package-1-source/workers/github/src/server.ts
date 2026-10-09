import { createHmac, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import {
  assertMissionV1, canonicalJson, missionContentHash, missionRequiresApproval,
  type MissionV1, type MissionApproval, type GitHubOperation, type GitHubRef
} from "@mission-runner/shared";

type Dispatch = { mission: MissionV1; operation: GitHubOperation; contentHash: string; approval?: MissionApproval };
const secret = process.env.GITHUB_WORKER_SHARED_SECRET;
const token = process.env.GITHUB_TOKEN;
const allowlist = new Set((process.env.GITHUB_REPO_ALLOWLIST ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
if (!secret || secret.length < 32) throw new Error("GITHUB_WORKER_SHARED_SECRET must be at least 32 characters");
if (!token) throw new Error("GITHUB_TOKEN is required");
if (!allowlist.size) throw new Error("GITHUB_REPO_ALLOWLIST must name at least one owner/repo");
const nonces = new Map<string, number>();
const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
await app.register(helmet);
await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });

function authorized(body: unknown, headers: Record<string, unknown>): boolean {
  const ts = headers["x-worker-timestamp"], nonce = headers["x-worker-nonce"], signature = headers["x-worker-signature"];
  if (typeof ts !== "string" || typeof nonce !== "string" || typeof signature !== "string" || !/^\d{10,13}$/.test(ts) || !/^[a-f0-9-]{16,80}$/i.test(nonce)) return false;
  const timestamp = Number(ts.length === 13 ? Math.floor(Number(ts) / 1000) : ts);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 60) return false;
  for (const [key, expiry] of nonces) if (expiry < Date.now()) nonces.delete(key);
  if (nonces.has(nonce)) return false;
  const message = ts + "." + nonce + "." + canonicalJson(body);
  const expected = createHmac("sha256", secret!).update(message).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "hex"); } catch { return false; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  nonces.set(nonce, Date.now() + 120_000);
  return true;
}
function targetAllows(mission: MissionV1, repo: string): boolean {
  const target = mission.target;
  const inMission = (target.kind === "github" || target.kind === "mixed") && target.repos.some(r => r.toLowerCase() === repo.toLowerCase());
  return inMission && allowlist.has(repo.toLowerCase());
}
function validateDispatch(input: Dispatch): void {
  assertMissionV1(input.mission);
  if (!input.operation || input.operation.kind !== "github") throw new Error("github_operation_required");
  if (!input.mission.operations.some(op => op.operationId === input.operation.operationId && canonicalJson(op) === canonicalJson(input.operation))) throw new Error("operation_not_in_mission");
}
async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch("https://api.github.com" + path, {
    ...init,
    headers: { accept: "application/vnd.github+json", authorization: "Bearer " + token, "x-github-api-version": "2022-11-28", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers }
  });
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: "Non-JSON GitHub response" }; }
  if (!response.ok) {
    const message = typeof data === "object" && data && "message" in data ? String((data as {message: unknown}).message) : "GitHub API error";
    throw Object.assign(new Error(message), { statusCode: response.status });
  }
  return data;
}
function encodePath(path: string): string { return path.split("/").map(encodeURIComponent).join("/"); }
async function resolveGitRef(base: string, ref: GitHubRef): Promise<string> {
  if (ref.type === "commit") return ref.sha;
  const prefix = ref.type === "branch" ? "heads" : "tags";
  const found = await api(base + "/git/ref/" + prefix + "/" + encodePath(ref.name)) as { object: { sha: string; type?: string } };
  if (found.object.type === "tag") {
    const tag = await api(base + "/git/tags/" + found.object.sha) as { object: { sha: string; type?: string } };
    return tag.object.sha;
  }
  return found.object.sha;
}
async function execute(mission: MissionV1, op: GitHubOperation): Promise<unknown> {
  if (!("repo" in op) || !targetAllows(mission, op.repo)) throw new Error("repository_not_allowed");
  const [owner, repo] = op.repo.split("/");
  const base = `/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}`;
  switch (op.op) {
    case "read_file": {
      const ref = op.ref ? "?" + new URLSearchParams({ ref: "name" in op.ref ? op.ref.name : op.ref.sha }) : "";
      const result = await api(base + "/contents/" + encodePath(op.path) + ref) as {type?:string;encoding?:string;content?:string;path?:string;name?:string;sha?:string};
      if (result.type === "dir") throw new Error("path_is_directory");
      return { path: result.path, name: result.name, sha: result.sha, encoding: op.encoding ?? "utf8", content: op.encoding === "base64" ? result.content : Buffer.from((result.content ?? "").replace(/\n/g, ""), "base64").toString("utf8") };
    }
    case "list_files": {
      const ref = op.ref ? "?" + new URLSearchParams({ ref: "name" in op.ref ? op.ref.name : op.ref.sha }) : "";
      return api(base + "/contents" + (op.path ? "/" + encodePath(op.path) : "") + ref);
    }
    case "list_issues": {
      const q = new URLSearchParams({ state: op.state ?? "open", per_page: String(Math.min(100, op.limit ?? 30)) });
      for (const label of op.labels ?? []) q.append("labels", label);
      return api(base + "/issues?" + q);
    }
    case "get_issue": return api(base + "/issues/" + op.issueNumber);
    case "list_pull_requests": return api(base + "/pulls?" + new URLSearchParams({ state: op.state ?? "open", per_page: String(Math.min(100, op.limit ?? 30)) }));
    case "get_pull_request": return api(base + "/pulls/" + op.pullNumber);
    case "list_commits": {
      const q = new URLSearchParams({ per_page: String(Math.min(100, op.limit ?? 30)) });
      if (op.ref) q.set("sha", "name" in op.ref ? op.ref.name : op.ref.sha);
      return api(base + "/commits?" + q);
    }
    case "create_branch": {
      const sha = await resolveGitRef(base, op.fromRef);
      return api(base + "/git/refs", { method:"POST", body: JSON.stringify({ ref: "refs/heads/" + op.branch, sha }) });
    }
    case "put_file": {
      const payload: Record<string, unknown> = { message: op.commitMessage, content: Buffer.from(op.content, "utf8").toString("base64"), branch: op.branch };
      if (op.expectedSha) payload.sha = op.expectedSha;
      return api(base + "/contents/" + encodePath(op.path), { method:"PUT", body: JSON.stringify(payload) });
    }
    case "open_pull_request": return api(base + "/pulls", { method:"POST", body: JSON.stringify({ title:op.title, head:op.head, base:op.base, body:op.body ?? "", draft:op.draft ?? true }) });
    case "comment_on_issue": return api(base + "/issues/" + op.issueNumber + "/comments", { method:"POST", body: JSON.stringify({ body:op.body }) });
    case "comment_on_pull_request": return api(base + "/issues/" + op.pullNumber + "/comments", { method:"POST", body: JSON.stringify({ body:op.body }) });
  }
}
app.get("/health", async () => ({ ok: true, service: "mission-runner-github-worker" }));
app.post("/execute", async (request, reply) => {
  if (!authorized(request.body, request.headers as Record<string, unknown>)) return reply.code(401).send({ error: "worker_auth_failed" });
  try {
    const input = request.body as Dispatch;
    validateDispatch(input);
    const digest = await missionContentHash(input.mission);
    if (digest !== input.contentHash || (input.mission.contentHash && input.mission.contentHash !== digest)) return reply.code(409).send({ error:"mission_hash_mismatch" });
    if (missionRequiresApproval(input.mission.declaredRiskLevel, input.mission.operations, input.mission.declaredRequiresApproval)) {
      if (!input.approval || input.approval.missionId !== input.mission.missionId || input.approval.contentHash !== digest || !input.approval.approvalId || !input.approval.approvedBy) return reply.code(403).send({ error:"approval_required" });
    }
    const result = await execute(input.mission, input.operation);
    return { ok:true, missionId:input.mission.missionId, operationId:input.operation.operationId, contentHash:digest, result };
  } catch (error) {
    const e = error as Error & { statusCode?:number };
    request.log.warn({ error:e.message }, "GitHub operation failed");
    return reply.code(e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400).send({ error:"github_operation_failed", message:e.message });
  }
});
const port = Number(process.env.PORT ?? "8791");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT invalid");
await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
