import { createGitHubClient } from './github.js';
import { normalizeLineEndings, sha256 } from './utils.js';

export async function runHealthCheck(zipContents, onProgress = null) {
    const client = createGitHubClient();
    const tree = await client.getTree(true, true);
    const repoFiles = tree.filter(item => item.type === 'blob').map(item => ({ path: item.path, sha: item.sha, size: item.size, mode: item.mode }));
    const repoPaths = new Set(repoFiles.map(item => item.path));
    const zipPaths = new Set(zipContents.map(f => f.path));
    const missing = zipContents.filter(f => !repoPaths.has(f.path));
    const extra = repoFiles.filter(item => !zipPaths.has(item.path));
    const zipDirs = new Set(); const repoDirs = new Set();
    zipContents.forEach(f => { const parts = f.path.split('/'); for (let i = 0; i < parts.length - 1; i++) { const dir = parts.slice(0, i + 1).join('/'); if (dir) zipDirs.add(dir); } });
    repoFiles.forEach(item => { const parts = item.path.split('/'); for (let i = 0; i < parts.length - 1; i++) { const dir = parts.slice(0, i + 1).join('/'); if (dir) repoDirs.add(dir); } });
    const missingDirs = [...zipDirs].filter(d => !repoDirs.has(d));
    const extraDirs = [...repoDirs].filter(d => !zipDirs.has(d));
    const commonFiles = zipContents.filter(f => repoPaths.has(f.path));
    let mismatched = [], binaryMismatches = [], errors = [];
    const total = commonFiles.length; let processed = 0;
    for (const zipFile of commonFiles) {
        try {
            const repoFile = repoFiles.find(item => item.path === zipFile.path);
            if (zipFile.isText) {
                const repoContent = await client.getFileText(zipFile.path);
                if (normalizeLineEndings(zipFile.content) !== normalizeLineEndings(repoContent)) mismatched.push(zipFile.path);
            } else {
                if (repoFile && repoFile.sha) {
                    const zipSha = await sha256(zipFile.content);
                    if (zipSha !== repoFile.sha) binaryMismatches.push(zipFile.path);
                } else if (zipFile.size !== repoFile.size) binaryMismatches.push(zipFile.path);
            }
        } catch (error) { errors.push({ path: zipFile.path, error: error.message }); }
        processed++; if (onProgress) onProgress(processed, total);
    }
    return { missing: missing.map(f => f.path), extra: extra.map(item => item.path), missingDirs, extraDirs, mismatched, binaryMismatches, errors, totals: { zipFiles: zipContents.length, repoFiles: repoFiles.length, checked: commonFiles.length, missing: missing.length, extra: extra.length, mismatched: mismatched.length, binaryMismatches: binaryMismatches.length, missingDirs: missingDirs.length, extraDirs: extraDirs.length, errors: errors.length } };
}

export function formatHealthReport(results) {
    const lines = [], totals = results.totals;
    const totalIssues = totals.missing + totals.extra + totals.mismatched + totals.binaryMismatches + totals.missingDirs + totals.extraDirs;
    lines.push('📊 Health Check Report'); lines.push('='.repeat(30));
    lines.push('📦 ZIP has: ' + totals.zipFiles + ' files');
    lines.push('📁 Repo has: ' + totals.repoFiles + ' files');
    lines.push('🔄 Checked: ' + totals.checked + ' files');
    lines.push('📊 Issues found: ' + totalIssues); lines.push('');
    if (totals.missingDirs > 0) { lines.push('📁 Missing directories: ' + totals.missingDirs); results.missingDirs.slice(0, 10).forEach(d => lines.push('  📂 ' + d)); if (totals.missingDirs > 10) lines.push('  ... and ' + (totals.missingDirs - 10) + ' more'); lines.push(''); }
    if (totals.extraDirs > 0) { lines.push('📁 Extra directories: ' + totals.extraDirs); results.extraDirs.slice(0, 10).forEach(d => lines.push('  📂 ' + d)); if (totals.extraDirs > 10) lines.push('  ... and ' + (totals.extraDirs - 10) + ' more'); lines.push(''); }
    if (totals.missing > 0) { lines.push('❌ Missing files: ' + totals.missing); results.missing.slice(0, 15).forEach(f => lines.push('  📄 ' + f)); if (totals.missing > 15) lines.push('  ... and ' + (totals.missing - 15) + ' more'); lines.push(''); }
    if (totals.extra > 0) { lines.push('⚠️ Extra files: ' + totals.extra); results.extra.slice(0, 15).forEach(f => lines.push('  📄 ' + f)); if (totals.extra > 15) lines.push('  ... and ' + (totals.extra - 15) + ' more'); lines.push(''); }
    if (totals.mismatched > 0) { lines.push('🔄 Mismatched content: ' + totals.mismatched); results.mismatched.slice(0, 15).forEach(f => lines.push('  📄 ' + f)); if (totals.mismatched > 15) lines.push('  ... and ' + (totals.mismatched - 15) + ' more'); lines.push(''); }
    if (totals.binaryMismatches > 0) { lines.push('🔢 Binary mismatches: ' + totals.binaryMismatches); results.binaryMismatches.slice(0, 10).forEach(f => lines.push('  📄 ' + f)); if (totals.binaryMismatches > 10) lines.push('  ... and ' + (totals.binaryMismatches - 10) + ' more'); lines.push(''); }
    if (totals.errors > 0) { lines.push('❌ Errors: ' + totals.errors); results.errors.slice(0, 10).forEach(e => lines.push('  📄 ' + e.path + ': ' + e.error)); if (totals.errors > 10) lines.push('  ... and ' + (totals.errors - 10) + ' more'); lines.push(''); }
    if (totalIssues === 0 && totals.errors === 0) lines.push('✅ All files match perfectly!');
    else { lines.push('⚠️ Found ' + totalIssues + ' issues (' + totals.errors + ' errors)'); if (totals.missing > 0 || totals.mismatched > 0 || totals.binaryMismatches > 0) lines.push('💡 Re-deploy ZIP to fix missing/mismatched files'); if (totals.extra > 0) lines.push('💡 Extra files can be deleted manually or ignored'); lines.push('📊 Health score: ' + Math.round(((totals.zipFiles - totalIssues) / totals.zipFiles) * 100) + '%'); }
    return lines.join('\n');
}
