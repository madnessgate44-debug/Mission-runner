export const GeminiProvider = {
    name: 'Gemini',
    defaultModel: 'gemini-pro',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    getHeaders() { return { 'Content-Type': 'application/json' }; },
    getEndpoint(endpoint, model, apiKey) { const base = endpoint || this.defaultEndpoint; return base + '/' + model + ':generateContent?key=' + apiKey; },
    buildRequestBody(model, messages, options = {}) {
        const contents = messages.map(msg => ({ role: msg.role === 'system' || msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] }));
        return { contents, generationConfig: { maxOutputTokens: options.maxTokens || 1000, temperature: options.temperature || 0.7 } };
    },
    parseResponse(data) { if (data.candidates && data.candidates.length > 0) { const candidate = data.candidates[0]; if (candidate.content && candidate.content.parts) return candidate.content.parts.map(p => p.text).join(''); } throw new Error('No response from Gemini'); },
    validateConfig(config) { if (!config.apiKey) throw new Error('Gemini API key is required'); return true; }
};
