import { createGitHubClient } from './github.js';
import { sanitizePath, sleep } from './utils.js';

export async function uploadFiles(files, options = {}) {
    const { cleanDuplicates = true, maxRetries = 3, retryDelay = 1000, onProgress = null, onFileProgress = null, commitMessage = 'Upload files via Mission Runner' } = options;
    const client = createGitHubClient();
    const results = { uploaded: [], failed: [], deleted: [], total: files.length };
    if (cleanDuplicates) {
        for (const file of files) {
            try { if (await client.fileExists(file.path)) { await client.deleteFile(file.path, 'Delete ' + file.path + ' (cleanup)'); results.deleted.push(file.path); } } catch (error) { console.warn('Failed to delete ' + file.path + ':', error); }
        }
    }
    const concurrency = 5;
    const chunks = [];
    for (let i = 0; i < files.length; i += concurrency) chunks.push(files.slice(i, i + concurrency));
    let uploadedCount = 0;
    const totalFiles = files.length;
    for (const chunk of chunks) {
        const promises = chunk.map(async (file, index) => {
            let attempt = 0, success = false;
            while (attempt < maxRetries && !success) {
                try {
                    await client.uploadFile(file.path, file.content, file.isText, commitMessage);
                    success = true;
                    results.uploaded.push(file.path);
                    if (onFileProgress) onFileProgress(file.path, 'success');
                } catch (error) {
                    attempt++;
                    if (attempt >= maxRetries) { results.failed.push({ path: file.path, error: error.message }); if (onFileProgress) onFileProgress(file.path, 'failed', error.message); } else { await sleep(retryDelay * attempt); }
                }
            }
            uploadedCount++;
            if (onProgress) onProgress(uploadedCount, totalFiles);
        });
        await Promise.all(promises);
    }
    return results;
}

export async function uploadZipContents(zipFiles, options = {}) {
    const defaultOptions = { cleanDuplicates: true, maxRetries: 3, retryDelay: 1000, commitMessage: 'Upload ZIP via Mission Runner' };
    const finalOptions = { ...defaultOptions, ...options };
    return uploadFiles(zipFiles, finalOptions);
}

export function getUploadSummary(results) {
    return { total: results.total, uploaded: results.uploaded.length, deleted: results.deleted.length, failed: results.failed.length, successRate: results.total > 0 ? Math.round((results.uploaded.length / results.total) * 100) : 0 };
}

export function formatUploadReport(results) {
    const summary = getUploadSummary(results);
    const lines = [];
    lines.push('📊 Upload Complete!'); lines.push('='.repeat(30));
    lines.push('📦 Total files: ' + summary.total);
    lines.push('✅ Uploaded: ' + summary.uploaded);
    lines.push('🧹 Deleted: ' + summary.deleted);
    lines.push('❌ Failed: ' + summary.failed);
    lines.push('📈 Success rate: ' + summary.successRate + '%');
    if (results.failed.length > 0) {
        lines.push(''); lines.push('⚠️ Failed files:');
        results.failed.slice(0, 15).forEach(f => { lines.push('  📄 ' + f.path + ': ' + f.error); });
        if (results.failed.length > 15) lines.push('  ... and ' + (results.failed.length - 15) + ' more');
    }
    return lines.join('\n');
}
