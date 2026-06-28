export const TEXT_EXTENSIONS = ['kt','xml','gradle','kts','toml','md','json','txt','yml','yaml','properties','java','js','html','css','gitignore','env','pro','sh','bat','cmd','conf','config','ini','cfg','xsd','dtd','ent','key','pem','crt','csr','pub','asc','gpg','sig','markdown','rst','tex','bib','sty','cls','bbx','cbx','dbx','lbx'];

export function isTextFile(filename) { const ext = filename.split('.').pop().toLowerCase(); return TEXT_EXTENSIONS.includes(ext); }

export function base64Encode(str) { if (typeof str !== 'string') str = String(str); const encoder = new TextEncoder(); const data = encoder.encode(str); let binary = ''; for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]); return btoa(binary); }

export function base64Decode(str) { const binary = atob(str.replace(/\n/g, '')); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return new TextDecoder().decode(bytes); }

export function normalizeLineEndings(text) { if (typeof text !== 'string') return text; return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }

export async function sha256(content) { if (typeof content === 'string') { const encoder = new TextEncoder(); const data = encoder.encode(content); const hashBuffer = await crypto.subtle.digest('SHA-256', data); const hashArray = Array.from(new Uint8Array(hashBuffer)); return hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); } const data = content instanceof Uint8Array ? content : new Uint8Array(content); const hashBuffer = await crypto.subtle.digest('SHA-256', data); const hashArray = Array.from(new Uint8Array(hashBuffer)); return hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); }

export function formatSize(bytes) { if (bytes === 0) return '0 B'; const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(bytes) / Math.log(k)); return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]; }

export function sanitizePath(path) { return path.replace(/^\/+/, '').replace(/\/+$/, ''); }

export function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function retry(fn, maxAttempts = 3, delay = 1000) { let lastError; for (let attempt = 1; attempt <= maxAttempts; attempt++) { try { return await fn(); } catch (e) { lastError = e; if (attempt === maxAttempts) throw e; await sleep(delay * Math.pow(2, attempt - 1)); } } throw lastError; }

export function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

export function shouldIgnorePath(path, ignorePatterns = []) { const defaultIgnore = ['.git', 'build', '.gradle', 'node_modules', '.idea', '.vscode', '*.log', '*.tmp', '.DS_Store', 'Thumbs.db']; const patterns = [...defaultIgnore, ...ignorePatterns]; for (const pattern of patterns) { if (pattern.includes('*')) { const regex = new RegExp(pattern.replace(/\*/g, '.*')); if (regex.test(path)) return true; } else { if (path.includes(pattern)) return true; } } return false; }
