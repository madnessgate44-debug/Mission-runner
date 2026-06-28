import { getGitHubToken, setGitHubToken, getRepoSettings, setRepoSettings, getAISettings, setAISettings, getUploadSettings, setUploadSettings, setVersion, getVersion } from './storage.js';
import { createGitHubClient } from './github.js';
import { loadZipContents, extractZipForDeployment, getZipSummary } from './zip.js';
import { runHealthCheck, formatHealthReport } from './health.js';
import { uploadZipContents, formatUploadReport } from './upload.js';
import { createWizard } from './wizard.js';
import { createDeploymentEngine, quickDeploy } from './deploy.js';
import { createUpdater, isMissionRunnerUpdate } from './updater.js';
import { formatSize, isTextFile, escapeHtml } from './utils.js';

const $ = id => document.getElementById(id);
const els = {
  conversation: $('conversation'), messageInput: $('messageInput'), sendBtn: $('sendBtn'),
  menuBtn: $('menuBtn'), sidebar: $('sidebar'), overlay: $('overlay'), closeSidebarBtn: $('closeSidebarBtn'),
  repoBadge: $('repoBadge'), wizardStatus: $('wizardStatus'), versionBadge: $('versionBadge'),
  tokenInput: $('tokenInput'), ownerInput: $('ownerInput'), repoInput: $('repoInput'), branchInput: $('branchInput'),
  saveTokenBtn: $('saveTokenBtn'), saveRepoBtn: $('saveRepoBtn'),
  aiProvider: $('aiProvider'), apiKey: $('apiKey'), modelName: $('modelName'), customEndpoint: $('customEndpoint'),
  wizardPrompt: $('wizardPrompt'), saveWizardBtn: $('saveWizardBtn'),
  uploadArea: $('uploadArea'), uploadZipArea: $('uploadZipArea'), fileInput: $('fileInput'), zipInput: $('zipInput'),
  fileList: $('fileList'), zipInfo: $('zipInfo'), uploadBtn: $('uploadBtn'), uploadZipBtn: $('uploadZipBtn'),
  deployBtn: $('deployBtn'), cleanDuplicates: $('cleanDuplicates'), autoHealthCheck: $('autoHealthCheck'),
  selfUpdateCheck: $('selfUpdateCheck'), progressBar: $('progressBar'), progressFill: $('progressFill'),
  progressStatus: $('progressStatus'), healthCheckBtn: $('healthCheckBtn'), triggerBuildBtn: $('triggerBuildBtn'),
  checkStatusBtn: $('checkStatusBtn'), chatAttachBtn: $('chatAttachBtn'), chatFileInput: $('chatFileInput'),
  chatFilePreview: $('chatFilePreview')
};

let selectedFiles = [], zipFile = null, lastZipContents = null, chatFiles = [], wizard = null, updater = null, isDeploying = false;

function init() {
  loadSettings(); setupEvents(); updateUI();
  const version = getVersion() || '1.0.0';
  els.versionBadge.textContent = 'v' + version;
  wizard = createWizard(); updater = createUpdater();
  addMessage('system', '👋 Mission Runner ready!');
  addMessage('wizard', 'Hello! I\'m your coding assistant. Set up your AI provider in the sidebar.');
}

function loadSettings() {
  const token = getGitHubToken(); if (token) els.tokenInput.value = token;
  const repo = getRepoSettings();
  if (repo.owner) els.ownerInput.value = repo.owner;
  if (repo.repo) els.repoInput.value = repo.repo;
  if (repo.branch) els.branchInput.value = repo.branch;
  const ai = getAISettings();
  if (ai.provider) els.aiProvider.value = ai.provider;
  if (ai.apiKey) els.apiKey.value = ai.apiKey;
  if (ai.model) els.modelName.value = ai.model;
  if (ai.endpoint) els.customEndpoint.value = ai.endpoint;
  if (ai.prompt) els.wizardPrompt.value = ai.prompt;
  const upload = getUploadSettings();
  els.cleanDuplicates.checked = upload.cleanDuplicates;
  els.autoHealthCheck.checked = upload.autoHealthCheck;
  els.selfUpdateCheck.checked = upload.selfUpdate;
}

function setupEvents() {
  els.menuBtn.onclick = openSidebar;
  els.overlay.onclick = closeSidebar;
  els.closeSidebarBtn.onclick = closeSidebar;
  els.saveTokenBtn.onclick = saveToken;
  els.saveRepoBtn.onclick = saveRepo;
  els.saveWizardBtn.onclick = saveWizard;
  els.uploadArea.onclick = () => els.fileInput.click();
  els.uploadZipArea.onclick = () => els.zipInput.click();
  els.fileInput.onchange = handleFileSelect;
  els.zipInput.onchange = handleZipSelect;
  els.uploadBtn.onclick = handleUpload;
  els.uploadZipBtn.onclick = handleZipUpload;
  els.deployBtn.onclick = handleDeploy;
  els.sendBtn.onclick = sendMessage;
  els.messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });
  els.chatAttachBtn.onclick = () => els.chatFileInput.click();
  els.chatFileInput.onchange = handleChatAttach;
  els.healthCheckBtn.onclick = () => { closeSidebar(); runHealthCheckAction(); };
  els.triggerBuildBtn.onclick = triggerBuild;
  els.checkStatusBtn.onclick = checkStatus;
}

function updateUI() {
  const repo = getRepoSettings();
  els.repoBadge.textContent = repo.owner && repo.repo ? repo.owner + '/' + repo.repo : 'No repo set';
  const ai = getAISettings();
  els.wizardStatus.textContent = ai.apiKey ? '🧙 Online (' + ai.provider + ')' : '🧙 Offline';
  els.wizardStatus.style.color = ai.apiKey ? '#34d399' : '#f87171';
}

function openSidebar() { els.sidebar.classList.add('open'); els.overlay.classList.add('open'); }
function closeSidebar() { els.sidebar.classList.remove('open'); els.overlay.classList.remove('open'); }

function saveToken() {
  const t = els.tokenInput.value.trim();
  if (t.length < 10) { addMessage('❌ Token too short.', 'error'); return; }
  setGitHubToken(t);
  addMessage('✅ Token saved.', 'success');
  closeSidebar(); updateUI();
}

function saveRepo() {
  const owner = els.ownerInput.value.trim(), repo = els.repoInput.value.trim(), branch = els.branchInput.value.trim() || 'main';
  if (!owner || !repo) { addMessage('❌ Owner and repo required.', 'error'); return; }
  setRepoSettings(owner, repo, branch);
  addMessage('✅ Repo set to ' + owner + '/' + repo, 'success');
  closeSidebar(); updateUI();
}

function saveWizard() {
  const settings = { provider: els.aiProvider.value, apiKey: els.apiKey.value.trim(), model: els.modelName.value.trim() || 'gpt-3.5-turbo', endpoint: els.customEndpoint.value.trim(), prompt: els.wizardPrompt.value.trim() };
  setAISettings(settings);
  wizard = createWizard();
  addMessage('✅ AI settings saved! Provider: ' + settings.provider, 'success');
  closeSidebar(); updateUI();
}

function handleFileSelect() {
  selectedFiles = Array.from(els.fileInput.files);
  els.fileList.innerHTML = selectedFiles.map(f => '<div>📄 ' + escapeHtml(f.name) + ' (' + formatSize(f.size) + ')</div>').join('');
  zipFile = null; els.zipInfo.textContent = '';
}

function handleZipSelect() {
  zipFile = els.zipInput.files[0];
  if (zipFile) {
    els.zipInfo.textContent = '📦 ZIP loaded: ' + escapeHtml(zipFile.name) + ' (' + formatSize(zipFile.size) + ')';
    selectedFiles = []; els.fileList.innerHTML = '';
    loadZipContents(zipFile);
  }
}

async function loadZipContents(file) {
  try {
    const zipData = await loadZipContents(file);
    lastZipContents = zipData;
    const summary = getZipSummary(zipData);
    els.zipInfo.textContent += ' | 📊 ' + summary.totalFiles + ' files, ' + summary.formattedSize;
    if (summary.isMissionRunnerUpdate) {
      addMessage('🔄 This ZIP contains a Mission Runner update!', 'warning');
      addMessage('wizard', '🔄 Mission Runner update detected! Use "Deploy" to self-upgrade.');
    }
    addMessage('success', '📦 Loaded ' + summary.totalFiles + ' files from ZIP');
  } catch (e) {
    addMessage('❌ Failed to load ZIP: ' + escapeHtml(e.message), 'error');
  }
}

async function handleUpload() {
  if (!selectedFiles.length) { addMessage('❌ No files selected.', 'error'); return; }
  const settings = getUploadSettings();
  const files = await prepareFiles(selectedFiles);
  await performUpload(files, { cleanDuplicates: settings.cleanDuplicates, autoHealthCheck: settings.autoHealthCheck, selfUpdate: settings.selfUpdate });
}

async function handleZipUpload() {
  if (!zipFile) { addMessage('❌ No ZIP file selected.', 'error'); return; }
  addMessage('system', '📦 Extracting ZIP...');
  try {
    const zipData = await loadZipContents(zipFile);
    const files = zipData.files;
    lastZipContents = zipData;
    const summary = getZipSummary(zipData);
    addMessage('success', '📦 Found ' + summary.totalFiles + ' files in ZIP (' + summary.formattedSize + ')');
    if (summary.isMissionRunnerUpdate && els.selfUpdateCheck.checked) {
      await handleSelfUpdate(zipFile);
      return;
    }
    const settings = getUploadSettings();
    await performUpload(files, { cleanDuplicates: settings.cleanDuplicates, autoHealthCheck: settings.autoHealthCheck, selfUpdate: settings.selfUpdate });
  } catch (e) {
    addMessage('❌ Error extracting ZIP: ' + escapeHtml(e.message), 'error');
  }
}

async function handleDeploy() {
  if (!zipFile) { addMessage('❌ No ZIP file selected.', 'error'); return; }
  if (isDeploying) { addMessage('⏳ Deployment in progress...', 'warning'); return; }
  isDeploying = true;
  addMessage('system', '🚀 Starting smart deployment...');
  try {
    const engine = createDeploymentEngine({ cleanDuplicates: els.cleanDuplicates.checked, maxConcurrency: 5, maxRetries: 3, commitMessage: 'Deploy via Mission Runner' });
    await engine.initialize(zipFile);
    const stats = engine.state.stats;
    addMessage('system', '📊 Deployment plan: ' + stats.toUpload + ' upload, ' + stats.toDelete + ' delete, ' + stats.toKeep + ' keep');
    const result = await engine.deploy((phase, current, total) => {
      const pct = Math.round((current / total) * 100);
      els.progressFill.style.width = pct + '%';
      els.progressStatus.textContent = phase + ': ' + current + '/' + total + ' (' + pct + '%)';
      els.progressStatus.style.display = 'block';
    });
    const report = engine.getReport(result);
    addMessage('system', report);
    if (els.selfUpdateCheck.checked) {
      const updateCheck = await updater.checkForUpdate(zipFile);
      if (updateCheck.isUpdate && updateCheck.isNewer) {
        addMessage('warning', '🔄 New version ' + updateCheck.newVersion + ' detected!');
        await handleSelfUpdate(zipFile);
        return;
      }
    }
    if (els.autoHealthCheck.checked && lastZipContents) {
      addMessage('system', '🏥 Running automatic health check...');
      await runHealthCheckAction();
    }
    if (result.failed.length === 0) addMessage('wizard', '✅ Deployment completed successfully! 🎉');
    else addMessage('wizard', '⚠️ Deployment completed with ' + result.failed.length + ' errors.');
  } catch (e) {
    addMessage('error', '❌ Deployment failed: ' + escapeHtml(e.message));
    addMessage('wizard', '❌ Deployment failed: ' + escapeHtml(e.message));
  } finally {
    isDeploying = false;
    els.progressBar.classList.remove('active');
    els.progressFill.style.width = '0%';
    els.progressStatus.style.display = 'none';
  }
}

async function handleSelfUpdate(zipFile) {
  addMessage('system', '🔄 Performing self-update...');
  try {
    const result = await updater.performUpdate(zipFile, (phase, current, total) => {
      const pct = Math.round((current / total) * 100);
      els.progressFill.style.width = pct + '%';
      els.progressStatus.textContent = 'Updating: ' + phase + ' ' + current + '/' + total + ' (' + pct + '%)';
      els.progressStatus.style.display = 'block';
    });
    addMessage('success', '✅ Self-update completed! Version ' + result.newVersion);
    addMessage('wizard', '✅ Mission Runner updated from ' + result.oldVersion + ' to ' + result.newVersion + '! 🔄');
    addMessage('system', '🔄 Reloading in 3 seconds...');
    setTimeout(() => location.reload(), 3000);
  } catch (e) {
    addMessage('error', '❌ Self-update failed: ' + escapeHtml(e.message));
    addMessage('wizard', '❌ Update failed: ' + escapeHtml(e.message));
  }
}

async function prepareFiles(files) {
  const result = [];
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const isText = isTextFile(path);
    const content = isText ? await readText(file) : await readB64(file);
    result.push({ path, content, isText });
  }
  return result;
}

function readText(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsText(file); }); }
function readB64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file); }); }

async function performUpload(files, options) {
  els.progressBar.classList.add('active');
  try {
    const results = await uploadZipContents(files, {
      cleanDuplicates: options.cleanDuplicates,
      onProgress: (done, total) => {
        const pct = Math.round((done / total) * 100);
        els.progressFill.style.width = pct + '%';
        els.progressStatus.textContent = 'Uploading: ' + done + '/' + total + ' (' + pct + '%)';
        els.progressStatus.style.display = 'block';
      }
    });
    els.progressBar.classList.remove('active');
    els.progressFill.style.width = '0%';
    els.progressStatus.style.display = 'none';
    const report = formatUploadReport(results);
    addMessage('system', report);
    if (options.autoHealthCheck && lastZipContents) {
      addMessage('system', '🏥 Running automatic health check...');
      await runHealthCheckAction();
    }
    if (results.failed.length === 0) addMessage('wizard', '✅ All files uploaded successfully! 🎉');
    else addMessage('wizard', '⚠️ Upload completed with ' + results.failed.length + ' errors.');
  } catch (e) {
    els.progressBar.classList.remove('active');
    els.progressFill.style.width = '0%';
    els.progressStatus.style.display = 'none';
    addMessage('error', '❌ Upload failed: ' + escapeHtml(e.message));
  }
}

async function runHealthCheckAction() {
  if (!lastZipContents) { addMessage('❌ No ZIP loaded.', 'error'); return; }
  const files = lastZipContents.files || lastZipContents;
  if (!files || files.length === 0) { addMessage('❌ No files in ZIP.', 'error'); return; }
  addMessage('system', '🏥 Running health check...');
  try {
    const results = await runHealthCheck(files, (done, total) => {
      const pct = Math.round((done / total) * 100);
      els.progressFill.style.width = pct + '%';
      els.progressStatus.textContent = 'Health check: ' + done + '/' + total + ' (' + pct + '%)';
      els.progressStatus.style.display = 'block';
    });
    const report = formatHealthReport(results);
    addMessage('system', report);
    const hasIssues = results.totals.missing + results.totals.extra + results.totals.mismatched + results.totals.binaryMismatches;
    if (hasIssues === 0 && results.totals.errors === 0) addMessage('wizard', '✅ Perfect match! Repository matches ZIP.');
    else addMessage('wizard', '⚠️ Found ' + hasIssues + ' issues. Check the report above.');
    els.progressFill.style.width = '0%';
    els.progressStatus.style.display = 'none';
  } catch (e) {
    addMessage('error', '❌ Health check failed: ' + escapeHtml(e.message));
    els.progressFill.style.width = '0%';
    els.progressStatus.style.display = 'none';
  }
}

async function triggerBuild() {
  try {
    const client = createGitHubClient();
    const workflows = await client.getWorkflows();
    if (!workflows.length) { addMessage('❌ No workflows found.', 'error'); return; }
    const wf = workflows[0];
    await client.triggerWorkflow(wf.id);
    addMessage('success', '🔨 Build triggered! (' + wf.name + ')');
    addMessage('system', 'Watch: https://github.com/' + client.owner + '/' + client.repo + '/actions');
  } catch (e) { addMessage('error', '❌ Failed to trigger build: ' + escapeHtml(e.message)); }
}

async function checkStatus() {
  try {
    const client = createGitHubClient();
    const runs = await client.getWorkflowRuns(5);
    if (!runs.length) { addMessage('system', 'No builds found yet.'); return; }
    const lines = runs.map(r => {
      const icon = r.conclusion === 'success' ? '✅' : r.conclusion === 'failure' ? '❌' : r.status === 'in_progress' ? '🔄' : '⏳';
      return icon + ' ' + r.name + ' — ' + (r.conclusion || r.status) + ' (' + new Date(r.created_at).toLocaleString() + ')';
    });
    addMessage('system', '📊 Last builds:\n' + lines.join('\n'));
  } catch (e) { addMessage('error', '❌ Failed to check status: ' + escapeHtml(e.message)); }
}

function handleChatAttach() {
  chatFiles = Array.from(els.chatFileInput.files);
  if (chatFiles.length > 0) {
    const totalSize = chatFiles.reduce((s, f) => s + f.size, 0);
    els.chatFilePreview.style.display = 'block';
    els.chatFilePreview.innerHTML = '📎 ' + chatFiles.map(f => escapeHtml(f.name)).join(', ') + ' (' + formatSize(totalSize) + ')';
  } else { els.chatFilePreview.style.display = 'none'; }
}

async function sendMessage() {
  const message = els.messageInput.value.trim();
  if (!message && chatFiles.length === 0) return;
  const userText = message || '📎 ' + chatFiles.map(f => f.name).join(', ');
  addMessage('user', userText);
  els.messageInput.value = '';
  const attachments = [...chatFiles];
  chatFiles = [];
  els.chatFilePreview.style.display = 'none';
  els.chatFileInput.value = '';
  const lower = message.toLowerCase();
  if (lower.includes('upload') && lower.includes('zip')) { if (zipFile) { await handleZipUpload(); return; } else { addMessage('wizard', '⚠️ No ZIP loaded.'); return; } }
  if (lower.includes('deploy')) { await handleDeploy(); return; }
  if (lower.includes('health') || lower.includes('check')) { await runHealthCheckAction(); return; }
  if (lower.includes('status') || lower.includes('build')) { await checkStatus(); return; }
  const ai = getAISettings();
  if (!ai.apiKey) { addMessage('wizard', '⚠️ Set API key in sidebar to chat.'); return; }
  const thinking = addMessage('wizard', '⏳ Thinking...');
  try {
    let context = '';
    for (const file of attachments) {
      if (file.size < 50000 && isTextFile(file.name)) {
        const content = await readText(file);
        context += '\n\n### ' + file.name + '\n```\n' + content.slice(0, 2000) + (content.length > 2000 ? '\n...' : '') + '\n```';
      }
    }
    const response = await fetch(ai.endpoint || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ai.apiKey },
      body: JSON.stringify({ model: ai.model || 'gpt-3.5-turbo', messages: [{ role: 'system', content: ai.prompt || 'You are a helpful assistant.' }, { role: 'user', content: message + '\n\nContext:' + context }], max_tokens: 1000, temperature: 0.7 })
    });
    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'No response.';
    thinking.remove();
    addMessage('wizard', reply);
  } catch (e) { thinking.remove(); addMessage('error', '❌ ' + escapeHtml(e.message.slice(0, 200))); }
}

function addMessage(type, content) {
  const d = document.createElement('div');
  const classes = { user: 'message user', wizard: 'message wizard', system: 'message ai', error: 'message ai error', success: 'message ai success', warning: 'message ai warning' };
  d.className = classes[type] || 'message ai';
  if (type === 'wizard') d.innerHTML = '<span class="wizard-name">🧙 Wizard:</span><br>' + escapeHtml(content).replace(/\n/g, '<br>');
  else d.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');
  els.conversation.appendChild(d);
  d.scrollIntoView({ behavior: 'smooth' });
  return d;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
