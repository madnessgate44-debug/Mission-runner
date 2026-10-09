import "./style.css";

type MissionSummary = {
  missionId: string;
  objective: string;
  status: string;
  contentHash: string;
  effectiveRisk: string;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
  approval?: { approvalId: string; approvedAt: string } | null;
  result?: unknown;
};
const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("App root is missing");
let csrfToken = "";
let tab: "browser" | "missions" = "browser";
let missions: MissionSummary[] = [];
let notice = "";
let noticeKind: "error" | "success" | "" = "";
const sampleMission = {
  schemaVersion: "mission.v1",
  missionId: "mission_replace_this_id",
  objective: "Read a repository README and inspect an allowed website.",
  createdBy: "assistant:chatgpt",
  createdAt: new Date().toISOString(),
  declaredRiskLevel: "low",
  declaredRequiresApproval: false,
  limits: { maxSeconds: 120, maxOperations: 5, maxRetries: 1, maxEvidenceBytes: 5242880, maxPages: 2, maxConcurrentPages: 1 },
  target: { kind: "mixed", repos: ["owner/repository"], domains: ["example.com"] },
  operations: [
    { kind: "github", op: "read_file", operationId: "read_readme_001", required: true, description: "Read the repository README.", repo: "owner/repository", path: "README.md", encoding: "utf8" },
    { kind: "browser", op: "navigate", operationId: "navigate_site_002", required: true, description: "Open the allowed website.", url: "https://example.com/", waitUntil: "domcontentloaded" },
    { kind: "browser", op: "get_title", operationId: "get_title_003", required: false, description: "Read the page title." }
  ],
  metadata: { source: "Mission Runner phone UI" }
};

async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (method !== "GET" && !path.endsWith("/auth/login") && csrfToken) headers.set("x-csrf-token", csrfToken);
  const response = await fetch("/api" + path, { ...options, method, headers, credentials: "same-origin" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? body.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[char] ?? char));
}
function setNotice(message: string, kind: "error" | "success" | "" = "") {
  notice = message;
  noticeKind = kind;
  const el = document.querySelector<HTMLElement>("#notice");
  if (el) {
    el.textContent = message;
    el.className = "notice" + (kind ? " " + kind : "");
    el.classList.toggle("hidden", !message);
  }
}
function loginScreen() {
  root!.innerHTML = `
    <div class="login-wrap"><section class="login-card">
      <div class="brand"><div class="brand-mark">MR</div><div><h1>Mission Runner</h1><div class="muted">Your private GitHub and browser control plane</div></div></div>
      <form id="loginForm"><div class="field"><label for="ownerPassword">Owner password</label><input id="ownerPassword" type="password" autocomplete="current-password" required minlength="12" /></div>
      <button class="primary" type="submit" style="width:100%">Unlock control panel</button></form>
      <p class="muted">Your session is protected by an HTTP-only cookie. Worker credentials are not stored in this page.</p>
      <div id="notice" class="notice hidden"></div>
    </section></div>`;
  document.querySelector<HTMLFormElement>("#loginForm")!.addEventListener("submit", async event => {
    event.preventDefault();
    const password = document.querySelector<HTMLInputElement>("#ownerPassword")!.value;
    try {
        await api("/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      document.querySelector<HTMLInputElement>("#ownerPassword")!.value = "";
      await loadSession();
      tab = "browser";
      render();
    } catch (error) { setNotice((error as Error).message, "error"); }
  });
}
function shell() {
  const browserTab = tab === "browser";
  root!.innerHTML = `
    <div class="app-shell">
      <header class="topbar"><div class="brand"><div class="brand-mark">MR</div><div><h1>Mission Runner</h1><div class="muted">Private AI execution workspace</div></div></div><button id="logoutBtn">Lock</button></header>
      <nav class="nav"><button data-tab="browser" class="${browserTab ? "active" : ""}">Browser</button><button data-tab="missions" class="${!browserTab ? "active" : ""}">Missions & GitHub</button></nav>
      <div id="notice" class="notice ${notice ? "" : "hidden"} ${noticeKind}">${esc(notice)}</div>
      ${browserTab ? browserView() : missionsView()}
      <p class="small">This is an execution foundation, not a claim of unrestricted access. Only allowlisted sites and repositories can be controlled. Actions that change remote state require mission approval.</p>
    </div>`;
  attachShellEvents();
  if (browserTab) refreshScreenshot();
  else loadMissions();
}
function browserView() {
  return `
    <section class="panel">
      <h2>Authenticated browser</h2>
      <p class="muted">This is our Playwright browser session, not TinyFish. Navigate to an allowed site, sign in directly here, then refresh the screenshot. Your sign-in stays in the browser profile and is not sent to an AI model.</p>
      <form id="navigateForm" class="browser-toolbar"><input id="browserUrl" type="url" placeholder="https://example.com" required /><button class="primary" type="submit">Go</button><button id="backBtn" type="button">Back</button><button id="refreshBtn" type="button">Refresh</button></form>
      <div class="browser-frame"><img id="browserScreen" alt="Remote browser screenshot. Tap an element to click it." /></div>
      <p class="small">Tap an element in the screenshot to click it. The image may be scaled to fit your phone.</p>
    </section>
    <section class="panel">
      <h2>Manual input</h2>
      <p class="muted">Text entered here is sent directly to the active browser tab. For login secrets, do not paste them into an AI conversation.</p>
      <form id="typeForm"><div class="row"><input id="browserText" type="password" autocomplete="off" placeholder="Text to type into the focused browser field" /><button class="primary" type="submit">Type</button></div></form>
      <div class="keyrow"><button data-key="Tab">Tab</button><button data-key="Enter">Enter</button><button data-key="Escape">Esc</button><button data-key="Backspace">Backspace</button><button data-key="ArrowUp">↑</button><button data-key="ArrowDown">↓</button></div>
    </section>`;
}
function missionsView() {
  const sample = { ...sampleMission, missionId: "mission_" + Date.now().toString(36), createdAt: new Date().toISOString() };
  return `
    <section class="panel">
      <h2>Create a bounded mission</h2>
      <p class="muted">Paste a Mission V1 JSON plan produced by ChatGPT, Gemini, or DeepSeek. Validate it before saving. GitHub write operations and browser clicks, typing, and submissions require approval.</p>
      <form id="missionForm"><textarea id="missionJson" spellcheck="false">${esc(JSON.stringify(sample, null, 2))}</textarea><div class="actions"><button class="primary" type="submit">Validate and save</button><button id="resetMissionBtn" type="button">Load example</button><button id="reloadMissionsBtn" type="button">Refresh list</button></div></form>
    </section>
    <section class="panel"><h2>Saved missions</h2><div id="missionList" class="mission-list"><p class="muted">Loading missions…</p></div></section>`;
}
function attachShellEvents() {
  root!.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(button => button.addEventListener("click", () => {
    tab = button.dataset.tab === "missions" ? "missions" : "browser";
    notice = "";
    render();
  }));
  document.querySelector<HTMLButtonElement>("#logoutBtn")?.addEventListener("click", async () => {
    try { await api("/auth/logout", { method: "POST", body: "{}" }); } catch {}
    csrfToken = "";
    notice = "";
    loginScreen();
  });
  document.querySelector<HTMLFormElement>("#navigateForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const url = document.querySelector<HTMLInputElement>("#browserUrl")!.value.trim();
    try { busy = true; await api("/browser/navigate", { method: "POST", body: JSON.stringify({ url }) }); setNotice("Browser navigated.", "success"); await refreshScreenshot(); }
    catch (error) { setNotice((error as Error).message, "error"); }
    finally { busy = false; }
  });
  document.querySelector<HTMLButtonElement>("#backBtn")?.addEventListener("click", async () => {
    try { await api("/browser/back", { method: "POST", body: "{}" }); await refreshScreenshot(); }
    catch (error) { setNotice((error as Error).message, "error"); }
  });
  document.querySelector<HTMLButtonElement>("#refreshBtn")?.addEventListener("click", refreshScreenshot);
  document.querySelector<HTMLFormElement>("#typeForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#browserText")!;
    const text = input.value;
    if (!text) return;
    try { await api("/browser/type", { method: "POST", body: JSON.stringify({ text }) }); input.value = ""; await refreshScreenshot(); setNotice("Text sent to browser.", "success"); }
    catch (error) { setNotice((error as Error).message, "error"); }
  });
  root!.querySelectorAll<HTMLButtonElement>("[data-key]").forEach(button => button.addEventListener("click", async () => {
    try { await api("/browser/press", { method: "POST", body: JSON.stringify({ key: button.dataset.key }) }); await refreshScreenshot(); }
    catch (error) { setNotice((error as Error).message, "error"); }
  }));
  document.querySelector<HTMLImageElement>("#browserScreen")?.addEventListener("click", async event => {
    const img = event.currentTarget as HTMLImageElement;
    if (!img.naturalWidth || !img.clientWidth) return;
    const rect = img.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) * img.naturalWidth / rect.width);
    const y = Math.round((event.clientY - rect.top) * img.naturalHeight / rect.height);
    try { await api("/browser/click", { method: "POST", body: JSON.stringify({ x, y }) }); await refreshScreenshot(); }
    catch (error) { setNotice((error as Error).message, "error"); }
  });
  document.querySelector<HTMLFormElement>("#missionForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const raw = document.querySelector<HTMLTextAreaElement>("#missionJson")!.value;
    let mission: unknown;
    try { mission = JSON.parse(raw); } catch { setNotice("Mission JSON is not valid JSON.", "error"); return; }
    try {
      const validated = await api<any>("/missions/validate", { method: "POST", body: JSON.stringify(mission) });
      const saved = await api<any>("/missions", { method: "POST", body: JSON.stringify(mission) });
      setNotice(`Mission saved. Risk: ${validated.effectiveRisk}. Approval required: ${validated.approvalRequired ? "yes" : "no"}. Status: ${saved.status}.`, "success");
      await loadMissions();
    } catch (error) { setNotice((error as Error).message, "error"); }
  });
  document.querySelector<HTMLButtonElement>("#resetMissionBtn")?.addEventListener("click", () => {
    const sample = { ...sampleMission, missionId: "mission_" + Date.now().toString(36), createdAt: new Date().toISOString() };
    document.querySelector<HTMLTextAreaElement>("#missionJson")!.value = JSON.stringify(sample, null, 2);
  });
  document.querySelector<HTMLButtonElement>("#reloadMissionsBtn")?.addEventListener("click", loadMissions);
}
async function refreshScreenshot() {
  const img = document.querySelector<HTMLImageElement>("#browserScreen");
  if (!img) return;
  try {
    const response = await fetch("/api/browser/screenshot", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Browser screenshot unavailable (${response.status})`);
    }
    const blob = await response.blob();
    const oldUrl = img.dataset.objectUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    const objectUrl = URL.createObjectURL(blob);
    img.dataset.objectUrl = objectUrl;
    img.src = objectUrl;
  } catch (error) { setNotice((error as Error).message + ". Check that the browser worker is running and its allowlist is configured.", "error"); }
}
async function loadMissions() {
  const container = document.querySelector<HTMLDivElement>("#missionList");
  if (!container) return;
  try {
    const result = await api<{missions: MissionSummary[]}>("/missions");
    missions = result.missions;
    container.innerHTML = missions.length ? missions.map(item => `
      <article class="mission">
        <div class="mission-head"><div><h3>${esc(item.objective)}</h3><div class="small">${esc(item.missionId)} · ${esc(new Date(item.createdAt).toLocaleString())}</div></div><span class="pill">${esc(item.status)}</span></div>
        <p class="muted">Risk: ${esc(item.effectiveRisk)} · Approval required: ${item.approvalRequired ? "yes" : "no"}</p>
        <div class="actions">${item.status === "awaiting_approval" ? `<button class="primary" data-approve="${esc(item.missionId)}">Approve exact mission</button>` : ""}${["validated","approved"].includes(item.status) ? `<button class="primary" data-execute="${esc(item.missionId)}">Execute mission</button>` : ""}${!["succeeded","failed","cancelled","expired"].includes(item.status) ? `<button class="danger" data-cancel="${esc(item.missionId)}">Cancel</button>` : ""}${item.result ? `<details style="margin-top:10px"><summary>Execution result</summary><pre class="small" style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(item.result,null,2).slice(0,8000))}</pre></details>` : ""}</div>
      </article>`).join("") : '<p class="muted">No missions saved yet.</p>';
    container.querySelectorAll<HTMLButtonElement>("[data-approve]").forEach(button => button.addEventListener("click", async () => {
      try {
        const result = await api<any>("/missions/" + encodeURIComponent(button.dataset.approve!) + "/approve", { method: "POST", body: "{}" });
        setNotice("Approval recorded for the exact content hash. Status: " + result.status + ".", "success");
        await loadMissions();
      } catch (error) { setNotice((error as Error).message, "error"); }
    }));
    container.querySelectorAll<HTMLButtonElement>("[data-execute]").forEach(button => button.addEventListener("click", async () => {
      if (!confirm("Run this exact mission against its declared repositories and domains?")) return;
      button.disabled = true;
      setNotice("Executing mission…", "");
      try {
        const result = await api<any>("/missions/" + encodeURIComponent(button.dataset.execute!) + "/execute", { method: "POST", body: "{}" });
        setNotice("Mission finished with status: " + result.status + ".", result.status === "succeeded" ? "success" : "error");
        await loadMissions();
      } catch (error) { setNotice((error as Error).message, "error"); await loadMissions(); }
    }));
    container.querySelectorAll<HTMLButtonElement>("[data-cancel]").forEach(button => button.addEventListener("click", async () => {
      try {
        await api("/missions/" + encodeURIComponent(button.dataset.cancel!) + "/cancel", { method: "POST", body: "{}" });
        setNotice("Mission cancelled.", "success");
        await loadMissions();
      } catch (error) { setNotice((error as Error).message, "error"); }
    }));
  } catch (error) { container.innerHTML = '<p class="notice error">' + esc((error as Error).message) + "</p>"; }
}
async function loadSession() {
  const result = await api<{csrfToken:string}>("/auth/csrf");
  csrfToken = result.csrfToken;
}
function render() {
  if (!csrfToken) { loginScreen(); return; }
  shell();
}
async function boot() {
  try { await loadSession(); render(); }
  catch { loginScreen(); }
}
void boot();
