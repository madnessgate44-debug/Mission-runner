import { getProvider } from './providers/index.js';
import { getAISettings } from './storage.js';
import { createGitHubClient } from './github.js';

export class Wizard {
    constructor() {
        this.settings = getAISettings();
        this.provider = getProvider(this.settings.provider);
        this.client = null;
        this.context = { repository: null, branch: null, files: [], zipLoaded: false, zipFiles: 0, recentCommits: [] };
    }
    async updateContext() {
        try {
            this.client = createGitHubClient();
            const settings = this.client;
            this.context.repository = settings.owner + '/' + settings.repo;
            this.context.branch = settings.branch;
            const files = await this.client.getAllFiles();
            this.context.files = files.slice(0, 50);
            const commits = await this.client.getCommits(5);
            this.context.recentCommits = commits.map(c => ({ message: c.commit.message.split('\n')[0], author: c.commit.author.name, date: c.commit.author.date }));
        } catch (error) { console.warn('Failed to update wizard context:', error); }
    }
    setZipContext(zipContents) {
        this.context.zipLoaded = true;
        this.context.zipFiles = zipContents.length;
        this.context.zipFileNames = zipContents.slice(0, 20).map(f => f.path);
        if (zipContents.length > 20) this.context.zipFileNames.push('... and ' + (zipContents.length - 20) + ' more');
    }
    buildSystemPrompt() {
        let prompt = this.settings.prompt || '';
        prompt += '\n\nCurrent Context:';
        prompt += '\nRepository: ' + (this.context.repository || 'Not set');
        prompt += '\nBranch: ' + (this.context.branch || 'Not set');
        prompt += '\nFiles: ' + this.context.files.length + ' files in repo';
        if (this.context.zipLoaded) prompt += '\nZIP loaded: ' + this.context.zipFiles + ' files';
        if (this.context.recentCommits.length > 0) { prompt += '\nRecent commits:'; this.context.recentCommits.forEach(c => { prompt += '\n- ' + c.message + ' (' + c.author + ')'; }); }
        prompt += '\n\nBe helpful, concise, and actionable.';
        return prompt;
    }
    async sendMessage(message, attachments = []) {
        await this.updateContext();
        this.provider.validateConfig(this.settings);
        const endpoint = this.provider.getEndpoint(this.settings.endpoint, this.settings.model, this.settings.apiKey);
        const messages = [{ role: 'system', content: this.buildSystemPrompt() }, { role: 'user', content: message }];
        if (attachments.length > 0) {
            let attachmentContext = '\n\nAttached files:';
            for (const file of attachments) {
                attachmentContext += '\n- ' + file.name;
                if (file.size < 50000 && this.isTextFile(file.name)) {
                    const content = await this.readFileContent(file);
                    attachmentContext += '\n```\n' + content.slice(0, 2000) + (content.length > 2000 ? '\n... (truncated)' : '') + '\n```';
                }
            }
            messages[1].content += attachmentContext;
        }
        const body = this.provider.buildRequestBody(this.settings.model, messages, { maxTokens: 1000, temperature: 0.7 });
        const headers = this.provider.getHeaders(this.settings.apiKey);
        const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!response.ok) { const error = await response.text(); throw new Error(this.settings.provider + ' error: ' + error.slice(0, 200)); }
        const data = await response.json();
        return this.provider.parseResponse(data);
    }
    isTextFile(filename) {
        const textExtensions = ['kt', 'xml', 'gradle', 'kts', 'toml', 'md', 'json', 'txt', 'yml', 'yaml', 'properties', 'java', 'js', 'html', 'css', 'gitignore', 'env', 'pro', 'sh', 'bat', 'cmd'];
        const ext = filename.split('.').pop().toLowerCase();
        return textExtensions.includes(ext);
    }
    readFileContent(file) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = e => resolve(e.target.result); r.onerror = reject; r.readAsText(file); }); }
}
export function createWizard() { return new Wizard(); }
