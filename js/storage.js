export function getItem(key, useSession = false) {
  const storage = useSession ? sessionStorage : localStorage;
  const value = storage.getItem('mr_' + key);
  if (!value) return null;
  try { return JSON.parse(value); } catch { return value; }
}
export function setItem(key, value, useSession = false) {
  const storage = useSession ? sessionStorage : localStorage;
  storage.setItem('mr_' + key, typeof value === 'string' ? value : JSON.stringify(value));
}
export function getGitHubToken() { return getItem('token', true) || ''; }
export function setGitHubToken(token) { setItem('token', token, true); }
export function getRepoSettings() { return { owner: getItem('owner', false) || '', repo: getItem('repo', false) || '', branch: getItem('branch', false) || 'main' }; }
export function setRepoSettings(owner, repo, branch) { setItem('owner', owner, false); setItem('repo', repo, false); setItem('branch', branch || 'main', false); }
export function getAISettings() { return { provider: getItem('ai_provider', false) || 'openai', apiKey: getItem('api_key', true) || '', model: getItem('model_name', false) || 'gpt-3.5-turbo', endpoint: getItem('custom_endpoint', false) || '', prompt: getItem('wizard_prompt', false) || 'You are a helpful coding assistant.' }; }
export function setAISettings(settings) { setItem('ai_provider', settings.provider, false); setItem('api_key', settings.apiKey, true); setItem('model_name', settings.model, false); setItem('custom_endpoint', settings.endpoint, false); setItem('wizard_prompt', settings.prompt, false); }
export function getUploadSettings() { return { cleanDuplicates: getItem('clean_duplicates', false) !== false, autoHealthCheck: getItem('auto_health_check', false) !== false, selfUpdate: getItem('self_update', false) !== false }; }
export function setUploadSettings(settings) { setItem('clean_duplicates', settings.cleanDuplicates, false); setItem('auto_health_check', settings.autoHealthCheck, false); setItem('self_update', settings.selfUpdate, false); }
