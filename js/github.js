import { getGitHubToken, getRepoSettings } from './storage.js';
import { retry, sanitizePath, base64Encode, base64Decode, sleep } from './utils.js';

export class GitHubClient {
    constructor(token, owner, repo, branch) {
        this.token = token || getGitHubToken();
        this.owner = owner || getRepoSettings().owner;
        this.repo = repo || getRepoSettings().repo;
        this.branch = branch || getRepoSettings().branch;
        this.baseUrl = 'https://api.github.com';
        this.cache = { tree: null, treeTimestamp: null, treeTTL: 60000 };
        this.rateLimit = { remaining: 5000, reset: Date.now() + 3600000 };
    }
    get headers() { return { 'Authorization': 'token ' + this.token, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }; }
    updateRateLimit(response) {
        const remaining = response.headers?.get('x-ratelimit-remaining');
        const reset = response.headers?.get('x-ratelimit-reset');
        if (remaining) this.rateLimit.remaining = parseInt(remaining);
        if (reset) this.rateLimit.reset = parseInt(reset) * 1000;
    }
    async request(path, method = 'GET', body = null, retries = 3) {
        const url = this.baseUrl + '/repos/' + this.owner + '/' + this.repo + path;
        const options = { method, headers: this.headers };
        if (body) options.body = JSON.stringify(body);
        return retry(async () => {
            if (this.rateLimit.remaining < 10) {
                const waitTime = Math.max(0, this.rateLimit.reset - Date.now());
                if (waitTime > 0) await sleep(waitTime + 1000);
            }
            const response = await fetch(url, options);
            this.updateRateLimit(response);
            const text = await response.text();
            if (!response.ok) throw new Error(text || 'HTTP ' + response.status);
            return text ? JSON.parse(text) : {};
        }, retries);
    }
    async getTree(recursive = true, forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this.cache.tree && (now - this.cache.treeTimestamp) < this.cache.treeTTL) return this.cache.tree;
        const response = await this.request('/git/trees/' + this.branch + '?recursive=' + (recursive ? 1 : 0));
        const tree = response.tree || [];
        this.cache.tree = tree; this.cache.treeTimestamp = now;
        return tree;
    }
    async getAllFiles(forceRefresh = false) {
        const tree = await this.getTree(true, forceRefresh);
        return tree.filter(item => item.type === 'blob').map(item => ({ path: item.path, sha: item.sha, size: item.size, mode: item.mode }));
    }
    async getFile(path) { return this.request('/contents/' + sanitizePath(path)); }
    async getFileText(path) { const file = await this.getFile(path); return base64Decode(file.content); }
    async fileExists(path) { try { await this.getFile(path); return true; } catch { return false; } }
    async uploadFile(path, content, isText = true, message = null) {
        const sanitizedPath = sanitizePath(path);
        let sha = null;
        try { const existing = await this.getFile(sanitizedPath); sha = existing.sha; } catch {}
        const body = { message: message || 'Upload ' + sanitizedPath, content: isText ? base64Encode(content) : content, branch: this.branch };
        if (sha) body.sha = sha;
        return this.request('/contents/' + sanitizedPath, 'PUT', body);
    }
    async deleteFile(path, message = null) {
        const sanitizedPath = sanitizePath(path);
        const file = await this.getFile(sanitizedPath);
        return this.request('/contents/' + sanitizedPath, 'DELETE', { message: message || 'Delete ' + sanitizedPath, sha: file.sha, branch: this.branch });
    }
    async triggerWorkflow(workflowId, ref = null) { return this.request('/actions/workflows/' + workflowId + '/dispatches', 'POST', { ref: ref || this.branch }); }
    async getWorkflows() { const response = await this.request('/actions/workflows'); return response.workflows || []; }
    async getWorkflowRuns(perPage = 5) { const response = await this.request('/actions/runs?per_page=' + perPage); return response.workflow_runs || []; }
}
export function createGitHubClient() { const settings = getRepoSettings(); const token = getGitHubToken(); return new GitHubClient(token, settings.owner, settings.repo, settings.branch); }
