import { createHmac, timingSafeEqual, randomUUID, createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { chromium, type BrowserContext, type Page } from "playwright";
import { assertMissionV1, canonicalJson, missionContentHash, missionRequiresApproval, type MissionV1, type MissionApproval, type BrowserOperation } from "@mission-runner/shared";
import { isAllowedUrl, domainMatches } from "./policy.js";

type Dispatch = { mission: MissionV1; operation: BrowserOperation; contentHash: string; approval?: MissionApproval };
const secret = process.env.BROWSER_WORKER_SHARED_SECRET;
if (!secret || secret.length < 32) throw new Error("BROWSER_WORKER_SHARED_SECRET must be at least 32 characters");
const rules = (process.env.BROWSER_DOMAIN_ALLOWLIST ?? "").split(",").map(s => s.trim()).filter(Boolean);
if (!rules.length) throw new Error("BROWSER_DOMAIN_ALLOWLIST must name at least one allowed domain");
const profileDir = resolve(process.env.BROWSER_PROFILE_DIR ?? "./.browser-profile");
const evidenceDir = resolve(process.env.BROWSER_EVIDENCE_DIR ?? "./.browser-evidence");
const nonces = new Map<string, number>();
const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
await app.register(helmet);
await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });
let context: BrowserContext | null = null;
let page: Page | null = null;
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.then(() => undefined, () => undefined);
  return next;
}
async function getPage(): Promise<Page> {
  if (!context) {
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
    context = await chromium.launchPersistentContext(profileDir, {
      headless: process.env.BROWSER_HEADLESS !== "false",
      viewport: { width: 1365, height: 900 },
      acceptDownloads: false,
      args: ["--disable-dev-shm-usage", "--no-first-run"]
    });
    await context.route("**/*", async route => {
      const url = route.request().url();
      if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) return route.continue();
      if (!(await isAllowedUrl(url, rules))) return route.abort("blockedbyclient");
      return route.continue();
    });
    page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(8000);
  }
  if (!page || page.isClosed()) page = await context!.newPage();
  return page;
}
function authorized(body: unknown, headers: Record<string, unknown>): boolean {
  const ts = headers["x-worker-timestamp"], nonce = headers["x-worker-nonce"], signature = headers["x-worker-signature"];
  if (typeof ts !== "string" || typeof nonce !== "string" || typeof signature !== "string" || !/^\d{10,13}$/.test(ts) || !/^[a-f0-9-]{16,80}$/i.test(nonce)) return false;
  const seconds = Number(ts.length === 13 ? Math.floor(Number(ts) / 1000) : ts);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 60) return false;
  for (const [key, expiry] of nonces) if (expiry < Date.now()) nonces.delete(key);
  if (nonces.has(nonce)) return false;
  const expected = createHmac("sha256", secret!).update(ts + "." + nonce + "." + canonicalJson(body)).digest();
  const supplied = Buffer.from(signature, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  nonces.set(nonce, Date.now() + 120000);
  return true;
}
function targetAllows(mission: MissionV1, hostname: string): boolean {
  const target = mission.target;
  return (target.kind === "browser" || target.kind === "mixed") &&
    target.domains.some(domain => domainMatches(hostname, domain)) &&
    rules.some(rule => domainMatches(hostname, rule));
}
function validateDispatch(input: Dispatch): void {
  assertMissionV1(input.mission);
  if (!input.operation || input.operation.kind !== "browser") throw new Error("browser_operation_required");
  if (!input.mission.operations.some(op => op.operationId === input.operation.operationId && canonicalJson(op) === canonicalJson(input.operation))) throw new Error("operation_not_in_mission");
}
async function currentAllowed(p: Page, mission: MissionV1): Promise<void> {
  if (p.url() === "about:blank") return;
  const url = new URL(p.url());
  if (!targetAllows(mission, url.hostname) || !(await isAllowedUrl(p.url(), rules))) throw new Error("current_page_outside_allowed_target");
}
async function runOperation(mission: MissionV1, op: BrowserOperation): Promise<unknown> {
  const p = await getPage();
  if (op.op === "navigate") {
    const url = new URL(op.url);
    if (!targetAllows(mission, url.hostname) || !(await isAllowedUrl(op.url, rules))) throw new Error("navigation_target_not_allowed");
    await p.goto(op.url, { waitUntil: op.waitUntil ?? "domcontentloaded", timeout: 20000 });
    if (!(await isAllowedUrl(p.url(), rules)) || !targetAllows(mission, new URL(p.url()).hostname)) throw new Error("redirect_target_not_allowed");
    if (op.settleMs) await p.waitForTimeout(Math.min(3000, Math.max(0, op.settleMs)));
    return { url: p.url(), title: await p.title() };
  }
  await currentAllowed(p, mission);
  switch (op.op) {
    case "screenshot": {
      await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
      const path = join(evidenceDir, randomUUID() + ".png");
      const bytes = await p.screenshot({ path, fullPage: op.fullPage ?? false, animations: "disabled", mask: [p.locator('input[type="password"]')] });
      return { captured: true, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    }
    case "extract_text": {
      const locator = op.selector ? p.locator(op.selector).first() : p.locator("body");
      const value = op.attribute ? await locator.getAttribute(op.attribute) : await locator.innerText();
      return { value: (value ?? "").slice(0, Math.min(20000, Math.max(1, op.maxChars ?? 5000))) };
    }
    case "click": await p.locator(op.selector).click({ timeout: op.timeoutMs ?? 5000 }); return { clicked: true };
    case "type": {
      const locator = p.locator(op.selector);
      if (op.clear ?? true) await locator.fill(op.text, { timeout: op.timeoutMs ?? 5000 });
      else await locator.pressSequentially(op.text, { timeout: op.timeoutMs ?? 5000 });
      return { typed: true };
    }
    case "wait_for_selector": await p.locator(op.selector).waitFor({ state: op.state ?? "visible", timeout: op.timeoutMs ?? 5000 }); return { found: true };
    case "submit_form": await p.locator(op.selector).evaluate((element) => {
      if (!(element instanceof HTMLFormElement)) throw new Error("selector_must_target_form");
      element.requestSubmit();
    }); return { submitted: true };
    case "assert_text": {
      const value = await p.locator(op.selector).innerText({ timeout: op.timeoutMs ?? 5000 });
      return { matches: value.includes(op.contains), text: value.slice(0, 2000) };
    }
    case "get_url": return { url: p.url() };
    case "get_title": return { title: await p.title() };
  }
}
app.get("/health", async () => ({ ok: true, service: "mission-runner-browser-worker", browser: "playwright", profileReady: !!context }));
app.post("/session/screenshot", async (request, reply) => {
  if (!authorized(request.body, request.headers as Record<string, unknown>)) return reply.code(401).send({ error: "worker_auth_failed" });
  try {
    const bytes = await serialize(async () => { const p = await getPage(); return p.screenshot({ animations: "disabled", mask: [p.locator('input[type="password"]')] }); });
    return reply.type("image/png").header("cache-control", "no-store").send(bytes);
  } catch (error) { return reply.code(500).send({ error: "screenshot_failed", message: (error as Error).message }); }
});
app.post("/session/navigate", async (request, reply) => {
  if (!authorized(request.body, request.headers as Record<string, unknown>)) return reply.code(401).send({ error: "worker_auth_failed" });
  const body = request.body as { url?: unknown };
  if (typeof body.url !== "string") return reply.code(400).send({ error: "url_required" });
  try {
    return await serialize(async () => {
      if (!(await isAllowedUrl(body.url as string, rules))) throw new Error("url_not_allowed");
      const p = await getPage();
      await p.goto(body.url as string, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (!(await isAllowedUrl(p.url(), rules))) throw new Error("redirect_target_not_allowed");
      return { url: p.url(), title: await p.title() };
    });
  } catch (error) { return reply.code(400).send({ error: "navigation_failed", message: (error as Error).message }); }
});
app.post("/session/click", async (request, reply) => {
  if (!authorized(request.body, request.headers as Record<string, unknown>)) return reply.code(401).send({ error: "worker_auth_failed" });
  const body = request.body as { x?: unknown; y?: unknown };
  if (typeof body.x !== "number" || typeof body.y !== "number" || !Number.isFinite(body.x) || !Number.isFinite(body.y) || body.x < 0 || body.y < 0 || body.x > 1365 || body.y > 900) return reply.code(400).send({ error: "coordinates_invalid" });
  try { await serialize(async () => { const p = await getPage(); await p.mouse.click(body.x as number, body.y as number); }); return { ok: true }; }
  catch (error) { return reply.code(400).send({ error: "click_failed", message: (error as Error).message }); }
});
app.post("/session/type", async (request, reply) => {
  if (!authorized(request.body, request.headers as Record<string, unknown>)) return reply.code(401).send({ error: "worker_auth_failed" });
  const body = request.body as { text?: unknown };
  if (typeof body.text !== "string" || body.text.length > 4000) return reply.code(400).send({ error: "text_invalid" });
  try { await serialize(async () => { const p = await getPage(); await p.keyboard.insertText(body.text as string); }); return { ok: true }; }
  catch (error) { return reply.code(400).send({ error: "type_failed", message: (error as Error).message }); }
});
app.post("/session/press", async (request, reply) => {
  if (!authorized(request.body, request.headers as Record<string, unknown>)) return reply.code(401).send({ error: "worker_auth_failed" });
  const body = request.body as { key?: unknown };
  const keys = new Set(["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);
  if (typeof body.key !== "string" || !keys.has(body.key)) return reply.code(400).send({ error: "key_not_allowed" });
  try { await serialize(async () => { const p = await getPage(); await p.keyboard.press(body.key as string); }); return { ok: true }; }
  catch (error) { return reply.code(400).send({ error: "press_failed", message: (error as Error).message }); }
});
app.post("/session/inspect", async (request, reply) => {
  if (!authorized(request.body, request.headers as Record<string, unknown>)) return reply.code(401).send({ error: "worker_auth_failed" });
  try {
    return await serialize(async () => {
      const p = await getPage();
      const text = await p.locator("body").innerText().catch(() => "");
      return { url: p.url(), title: await p.title().catch(() => ""), text: text.slice(0, 8000) };
    });
  } catch (error) { return reply.code(500).send({ error: "inspect_failed", message: (error as Error).message }); }
});
app.post("/session/back", async (request, reply) => {
  if (!authorized(request.body, request.headers as Record<string, unknown>)) return reply.code(401).send({ error: "worker_auth_failed" });
  try { return await serialize(async () => { const p = await getPage(); await p.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => null); return { url: p.url(), title: await p.title() }; }); }
  catch (error) { return reply.code(400).send({ error: "back_failed", message: (error as Error).message }); }
});
app.post("/execute", async (request, reply) => {
  if (!authorized(request.body, request.headers as Record<string, unknown>)) return reply.code(401).send({ error: "worker_auth_failed" });
  try {
    const input = request.body as Dispatch;
    validateDispatch(input);
    const digest = await missionContentHash(input.mission);
    if (digest !== input.contentHash || (input.mission.contentHash && input.mission.contentHash !== digest)) return reply.code(409).send({ error: "mission_hash_mismatch" });
    if (missionRequiresApproval(input.mission.declaredRiskLevel, input.mission.operations, input.mission.declaredRequiresApproval)) {
      if (!input.approval || input.approval.missionId !== input.mission.missionId || input.approval.contentHash !== digest || !input.approval.approvalId || !input.approval.approvedBy) return reply.code(403).send({ error: "approval_required" });
    }
    const result = await serialize(() => runOperation(input.mission, input.operation));
    return { ok: true, missionId: input.mission.missionId, operationId: input.operation.operationId, contentHash: digest, result };
  } catch (error) { const e = error as Error; request.log.warn({ error: e.message }, "Browser operation failed"); return reply.code(400).send({ error: "browser_operation_failed", message: e.message }); }
});
app.addHook("onClose", async () => { if (context) await context.close(); });
const port = Number(process.env.PORT ?? "8792");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT invalid");
await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
