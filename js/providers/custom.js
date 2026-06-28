export const CustomProvider = {
    name: 'Custom',
    defaultModel: 'default',
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    getHeaders(apiKey) { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }; },
    getEndpoint(endpoint) { if (!endpoint) throw new Error('Custom endpoint URL is required'); return endpoint; },
    buildRequestBody(model, messages, options = {}) { return { model: model || this.defaultModel, messages, max_tokens: options.maxTokens || 1000, temperature: options.temperature || 0.7 }; },
    parseResponse(data) { if (data.choices && data.choices.length > 0) return data.choices[0].message.content; throw new Error('No response from custom provider'); },
    validateConfig(config) { if (!config.apiKey) throw new Error('API key is required for custom provider'); if (!config.endpoint) throw new Error('Custom endpoint URL is required'); return true; }
};
