import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { bearerTokenMatches } from "./auth.js";

const port = Number(process.env.PORT ?? "8780");
const host = process.env.HOST ?? "0.0.0.0";
const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const backendSecret = process.env.AI_TOOL_SHARED_SECRET ?? "";
const accessToken = process.env.MCP_ACCESS_TOKEN ?? "";
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT invalid");
if (backendSecret.length < 32) throw new Error("AI_TOOL_SHARED_SECRET must be at least 32 characters");
if (accessToken.length < 32) throw new Error("MCP_ACCESS_TOKEN must be at least 32 characters");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
const transports = new Map<string, StreamableHTTPServerTransport>();

async function backend(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("x-ai-tool-key", backendSecret);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const url = new URL(path.replace(/^\//, ""), backendUrl.endsWith("/") ? backendUrl : backendUrl + "/");
  const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(30000) });
  const payload = await response.json().catch(() => ({ error: "backend_invalid_response" })) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.message ?? payload.error ?? "backend_request_failed"));
  return payload;
}
function toolText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
function toolError(error: unknown) {
  return { content: [{ type: "text" as const, text: "Mission Runner error: " + (error instanceof Error ? error.message : "unknown error") }], isError: true };
}
function createMcpServer(): McpServer {
  const server = new McpServer({ name: "mission-runner", version: "0.1.0" });
  server.registerTool("mission_validate", {
    description: "Validate a bounded Mission V1 plan and calculate its effective risk and approval requirements. This does not execute it.",
    inputSchema: { mission: z.record(z.string(), z.unknown()) }
  }, async ({ mission }) => {
    try { return toolText(await backend("/missions/validate", { method: "POST", body: JSON.stringify(mission) })); }
    catch (error) { return toolError(error); }
  });
  server.registerTool("mission_create", {
    description: "Save a validated Mission V1 plan. Plans that need approval are saved as awaiting_approval; this tool cannot approve them.",
    inputSchema: { mission: z.record(z.string(), z.unknown()) }
  }, async ({ mission }) => {
    try { return toolText(await backend("/missions", { method: "POST", body: JSON.stringify(mission) })); }
    catch (error) { return toolError(error); }
  });
  server.registerTool("mission_list", {
    description: "List recent saved missions and their current states.",
    inputSchema: { limit: z.number().int().min(1).max(100).optional() }
  }, async ({ limit }) => {
    try { return toolText(await backend("/missions" + (limit ? "?limit=" + limit : ""))); }
    catch (error) { return toolError(error); }
  });
  server.registerTool("mission_get", {
    description: "Get one saved mission, including its state and last execution result.",
    inputSchema: { missionId: z.string().min(1).max(128) }
  }, async ({ missionId }) => {
    try { return toolText(await backend("/missions/" + encodeURIComponent(missionId))); }
    catch (error) { return toolError(error); }
  });
  server.registerTool("mission_execute", {
    description: "Execute a saved mission only if its current state and approval policy allow it. It cannot approve a mission. GitHub writes and browser click/type/form-submit require owner approval first.",
    inputSchema: { missionId: z.string().min(1).max(128) }
  }, async ({ missionId }) => {
    try { return toolText(await backend("/missions/" + encodeURIComponent(missionId) + "/execute", { method: "POST", body: "{}" })); }
    catch (error) { return toolError(error); }
  });
  server.registerTool("mission_cancel", {
    description: "Cancel a non-terminal mission. Cancellation is cooperative and may not interrupt an operation already in progress.",
    inputSchema: { missionId: z.string().min(1).max(128) }
  }, async ({ missionId }) => {
    try { return toolText(await backend("/missions/" + encodeURIComponent(missionId) + "/cancel", { method: "POST", body: "{}" })); }
    catch (error) { return toolError(error); }
  });
  server.registerTool("browser_inspect", {
    description: "Inspect the current page in the private persistent Playwright browser. Returns bounded page text and URL with common token patterns redacted. Do not ask the owner to share passwords in chat.",
    inputSchema: {}
  }, async () => {
    try { return toolText(await backend("/browser/inspect")); }
    catch (error) { return toolError(error); }
  });
  server.onerror = error => console.error("MCP server error:", error.message);
  return server;
}
function requireBearer(req: Request, res: Response, next: NextFunction) {
  if (!bearerTokenMatches(req.headers.authorization, accessToken)) {
    res.status(401).json({ error: "unauthorized", message: "A valid bearer token is required." });
    return;
  }
  next();
}
app.get("/health", (_req, res) => res.json({ ok: true, service: "mission-runner-mcp-gateway", protocol: "MCP Streamable HTTP" }));
app.use("/mcp", requireBearer);

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  try {
    let transport: StreamableHTTPServerTransport | undefined;
    if (typeof sessionId === "string") {
      transport = transports.get(sessionId);
      if (!transport) { res.status(400).json({ error: "unknown_mcp_session" }); return; }
    } else if (isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: id => { transports.set(id, transport!); }
      });
      transport.onclose = () => { if (transport?.sessionId) transports.delete(transport.sessionId); };
      await createMcpServer().connect(transport);
    } else {
      res.status(400).json({ error: "mcp_initialize_required" });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error instanceof Error ? error.message : "unknown");
    if (!res.headersSent) res.status(500).json({ error: "mcp_internal_error" });
  }
});
app.get("/mcp", async (req, res) => {
  const id = req.headers["mcp-session-id"];
  const transport = typeof id === "string" ? transports.get(id) : undefined;
  if (!transport) { res.status(400).send("Unknown MCP session"); return; }
  try { await transport.handleRequest(req, res); }
  catch (error) { console.error("MCP stream failed:", error instanceof Error ? error.message : "unknown"); if (!res.headersSent) res.status(500).end(); }
});
app.delete("/mcp", async (req, res) => {
  const id = req.headers["mcp-session-id"];
  const transport = typeof id === "string" ? transports.get(id) : undefined;
  if (!transport) { res.status(400).send("Unknown MCP session"); return; }
  try { await transport.handleRequest(req, res); }
  catch (error) { console.error("MCP close failed:", error instanceof Error ? error.message : "unknown"); if (!res.headersSent) res.status(500).end(); }
});
app.listen(port, host, () => console.error("Mission Runner MCP gateway listening on " + host + ":" + port));
