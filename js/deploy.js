import { createGitHubClient } from './github.js';
import { loadZipContents } from './zip.js';
import { retry, sleep } from './utils.js';

const DEPLOYMENT_OPTIONS = { maxConcurrency: 5, maxRetries: 3, retryDelay: 1000, commitMessage: 'Deploy via Mission Runner', rollbackOnFailure: true };

export class DeploymentEngine {
    constructor(options = {}) {
        this.options = { ...DEPLOYMENT_OPTIONS, ...options };
        this.client = createGitHubClient();
        this.state = { files: [], repoFiles: [], toUpload: [], toDelete: [], toKeep: [], uploaded: [], deleted: [], failed: [], rollback: [] };
        this.isRollingBack = false; this.deploymentId = Date.now().toString(36); this.startTime = Date.now();
    }
    async initialize(zipFile) {
        const zipData = await loadZipContents(zipFile);
        this.state.files = zipData.files;
        this.state.zipData = zipData;
        const repoTree = await this.client.getTree(true, true);
        this.state.repoFiles = repoTree.filter(item => item.type === 'blob').map(item => ({ path: item.path, sha: item.sha, size: item.size, mode: item.mode }));
        this.analyzeDifferences();
        return this.state;
    }
    analyzeDifferences() {
        const zipPaths = new Set(this.state.files.map(f => f.path));
        const repoPaths = new Set(this.state.repoFiles.map(f => f.path));
        this.state.toUpload = this.state.files.filter(f => { const repoFile = this.state.repoFiles.find(rf => rf.path === f.path); if (!repoFile) return true; if (repoFile.sha) return f.sha !== repoFile.sha; return true; });
        this.state.toDelete = this.state.repoFiles.filter(rf => !zipPaths.has(rf.path)).map(rf => rf.path);
        this.state.toKeep = this.state.files.filter(f => repoPaths.has(f.path) && !this.state.toUpload.includes(f));
        this.state.stats = { totalZip: this.state.files.length, totalRepo: this.state.repoFiles.length, toUpload: this.state.toUpload.length, toDelete: this.state.toDelete.length, toKeep: this.state.toKeep.length };
    }
    async deploy(onProgress = null) {
        const state = this.state;
        let uploadedCount = 0, deletedCount = 0;
        try {
            if (state.toDelete.length > 0) {
                if (onProgress) onProgress('deleting', 0, state.toDelete.length);
                for (let i = 0; i < state.toDelete.length; i++) {
                    const path = state.toDelete[i];
                    try { await this.client.deleteFile(path, 'Delete ' + path + ' (deployment)'); state.deleted.push(path); deletedCount++; if (onProgress) onProgress('deleting', i + 1, state.toDelete.length); } catch (error) { if (!error.message.includes('404')) throw new Error('Failed to delete ' + path + ': ' + error.message); state.deleted.push(path); deletedCount++; }
                }
            }
            if (state.toUpload.length > 0) {
                if (onProgress) onProgress('uploading', 0, state.toUpload.length);
                const concurrency = this.options.maxConcurrency;
                const chunks = [];
                for (let i = 0; i < state.toUpload.length; i += concurrency) chunks.push(state.toUpload.slice(i, i + concurrency));
                let uploadedFiles = 0;
                for (const chunk of chunks) {
                    const promises = chunk.map(async (file) => {
                        try {
                            await retry(async () => { await this.client.uploadFile(file.path, file.content, file.isText, this.options.commitMessage); }, this.options.maxRetries, this.options.retryDelay);
                            state.uploaded.push(file.path);
                            uploadedFiles++;
                            if (onProgress) onProgress('uploading', uploadedFiles, state.toUpload.length);
                        } catch (error) { state.failed.push({ path: file.path, error: error.message }); if (state.failed.length > 5) throw new Error('Too many failures: ' + state.failed.length); }
                    });
                    await Promise.all(promises);
                }
            }
            const dirs = new Set();
            state.files.forEach(f => { const parts = f.path.split('/'); for (let i = 0; i < parts.length - 1; i++) { const dir = parts.slice(0, i + 1).join('/'); if (dir) dirs.add(dir); } });
            const existingDirs = new Set();
            for (const repoFile of this.state.repoFiles) { const parts = repoFile.path.split('/'); for (let i = 0; i < parts.length - 1; i++) { const dir = parts.slice(0, i + 1).join('/'); if (dir) existingDirs.add(dir); } }
            for (const dir of dirs) {
                if (!existingDirs.has(dir)) { try { await this.client.createDirectory(dir, 'Create directory ' + dir); } catch (error) { console.warn('Failed to create directory ' + dir + ':', error); } }
            }
            return { success: state.failed.length === 0, stats: state.stats, uploaded: state.uploaded, deleted: state.deleted, failed: state.failed, duration: Date.now() - this.startTime };
        } catch (error) {
            if (this.options.rollbackOnFailure) await this.rollback(error);
            throw error;
        }
    }
    async rollback(error) {
        if (this.isRollingBack) return;
        this.isRollingBack = true;
        try {
            for (const path of this.state.uploaded) { try { await this.client.deleteFile(path, 'Rollback: delete ' + path); } catch (e) { console.warn('Rollback failed for ' + path + ':', e); } }
            this.state.rollback = this.state.uploaded;
            console.error('Deployment rolled back:', error.message);
        } finally { this.isRollingBack = false; }
    }
    getReport(result) {
        const lines = [], duration = (result.duration / 1000).toFixed(2);
        lines.push('📊 Deployment Report'); lines.push('='.repeat(30));
        lines.push('🆔 Deployment: ' + this.deploymentId);
        lines.push('⏱️ Duration: ' + duration + 's'); lines.push('');
        lines.push('📦 ZIP files: ' + result.stats.totalZip);
        lines.push('📁 Repo files: ' + result.stats.totalRepo);
        lines.push('📤 Uploaded: ' + result.uploaded.length);
        lines.push('🗑️ Deleted: ' + result.deleted.length);
        lines.push('❌ Failed: ' + result.failed.length);
        if (result.failed.length > 0) {
            lines.push(''); lines.push('⚠️ Failed files:');
            result.failed.slice(0, 10).forEach(f => { lines.push('  📄 ' + f.path + ': ' + f.error); });
            if (result.failed.length > 10) lines.push('  ... and ' + (result.failed.length - 10) + ' more');
        }
        return lines.join('\n');
    }
}
export function createDeploymentEngine(options = {}) { return new DeploymentEngine(options); }
