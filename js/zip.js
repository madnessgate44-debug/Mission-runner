import { isTextFile, shouldIgnorePath, sha256 } from './utils.js';

const IGNORE_PATTERNS = ['.git', 'build', '.gradle', 'node_modules', '.idea', '.vscode', '*.log', '*.tmp', '.DS_Store', 'Thumbs.db'];

export async function loadZipContents(file) {
    try {
        const zip = await JSZip.loadAsync(file);
        const files = [];
        for (const [path, entry] of Object.entries(zip.files)) {
            if (entry.dir || !path || path.trim() === '') continue;
            if (shouldIgnorePath(path, IGNORE_PATTERNS)) continue;
            try {
                const isText = isTextFile(path);
                let content, size = entry._data?.uncompressedSize || 0;
                if (isText) { content = await entry.async('string'); } else {
                    const arrayBuffer = await entry.async('arraybuffer');
                    const bytes = new Uint8Array(arrayBuffer);
                    let binary = ''; for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                    content = btoa(binary); size = bytes.length;
                }
                const isSelfUpdate = path === 'index.html' || path === 'js/main.js' || path === 'version.json' || (path.endsWith('index.html') && content.includes('Mission Runner'));
                files.push({ path, content, isText, size, isSelfUpdate, hash: await sha256(content) });
            } catch (error) { console.warn('Failed to read file: ' + path, error); }
        }
        const isMissionRunnerUpdate = files.some(f => f.isSelfUpdate);
        return { files, filePaths: files.map(f => f.path), totalFiles: files.length, totalSize: files.reduce((sum, f) => sum + (f.size || 0), 0), isMissionRunnerUpdate };
    } catch (error) { throw new Error('Failed to load ZIP: ' + error.message); }
}

export function getZipSummary(zipData) {
    const { files, totalFiles, totalSize, isMissionRunnerUpdate } = zipData;
    const textFiles = files.filter(f => f.isText).length;
    const binaryFiles = totalFiles - textFiles;
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(totalSize) / Math.log(k));
    const formattedSize = parseFloat((totalSize / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    return { totalFiles, textFiles, binaryFiles, totalSize, isMissionRunnerUpdate, formattedSize };
}
