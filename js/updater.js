import { createGitHubClient } from './github.js';
import { loadZipContents } from './zip.js';
import { setVersion, getVersion } from './storage.js';
import { base64Decode } from './utils.js';

const VERSION_FILE = 'version.json';
const REQUIRED_FILES = ['index.html', 'css/main.css', 'js/main.js', 'js/storage.js', 'js/github.js', 'js/upload.js', 'js/zip.js', 'js/health.js', 'js/wizard.js', 'js/chat.js', 'js/ui.js', 'js/updater.js', 'js/deploy.js', 'js/utils.js'];

export class Updater {
    constructor() {
        this.client = createGitHubClient();
        this.currentVersion = getVersion() || '1.0.0';
        this.newVersion = null; this.updateFiles = []; this.isUpdating = false;
    }
    async checkForUpdate(zipFile) {
        try {
            const zipData = await loadZipContents(zipFile);
            const versionFile = zipData.files.find(f => f.path === VERSION_FILE);
            if (!versionFile) return { isUpdate: false, error: 'No version.json found' };
            const newVersion = JSON.parse(versionFile.content).version;
            const isNewer = this.isVersionNewer(newVersion, this.currentVersion);
            return { isUpdate: true, newVersion, isNewer, currentVersion: this.currentVersion, files: zipData.files, totalFiles: zipData.totalFiles };
        } catch (error) { return { isUpdate: false, error: error.message }; }
    }
    isVersionNewer(newVer, currentVer) {
        const newParts = newVer.split('.').map(Number);
        const currentParts = currentVer.split('.').map(Number);
        for (let i = 0; i < Math.max(newParts.length, currentParts.length); i++) {
            const newPart = newParts[i] || 0, currentPart = currentParts[i] || 0;
            if (newPart > currentPart) return true;
            if (newPart < currentPart) return false;
        } return false;
    }
    async performUpdate(zipFile, onProgress = null) {
        if (this.isUpdating) throw new Error('Update already in progress');
        this.isUpdating = true;
        try {
            const check = await this.checkForUpdate(zipFile);
            if (!check.isUpdate) throw new Error(check.error || 'Not a valid Mission Runner update');
            if (!check.isNewer) throw new Error('Version ' + check.newVersion + ' is not newer than ' + this.currentVersion);
            this.newVersion = check.newVersion; this.updateFiles = check.files;
            const updateFiles = this.updateFiles.filter(f => REQUIRED_FILES.some(req => f.path === req || f.path.endsWith(req)));
            if (updateFiles.length === 0) throw new Error('No required files found in update');
            if (onProgress) onProgress('preparing', 0, updateFiles.length);
            const backup = await this.backupCurrentFiles();
            let uploaded = 0;
            for (const file of updateFiles) {
                try {
                    await this.client.uploadFile(file.path, file.content, file.isText, 'Update Mission Runner to ' + this.newVersion);
                    uploaded++;
                    if (onProgress) onProgress('uploading', uploaded, updateFiles.length);
                } catch (error) {
                    await this.rollbackUpdate(backup);
                    throw new Error('Failed to update ' + file.path + ': ' + error.message);
                }
            }
            setVersion(this.newVersion);
            this.currentVersion = this.newVersion;
            this.isUpdating = false;
            return { success: true, newVersion: this.newVersion, oldVersion: this.currentVersion, filesUpdated: updateFiles.length };
        } catch (error) { this.isUpdating = false; throw error; }
    }
    async backupCurrentFiles() {
        const backup = {};
        for (const path of REQUIRED_FILES) {
            try { const file = await this.client.getFile(path); backup[path] = { content: file.content, sha: file.sha }; } catch {}
        } return backup;
    }
    async rollbackUpdate(backup) {
        console.log('Rolling back update...');
        for (const [path, data] of Object.entries(backup)) {
            try { await this.client.uploadFile(path, base64Decode(data.content), true, 'Rollback update to ' + this.currentVersion); } catch (error) { console.error('Failed to rollback ' + path + ':', error); }
        }
    }
}
export function createUpdater() { return new Updater(); }
