export const DeepSeekProvider = {
    name: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    defaultEndpoint: 'https://api.deepseek.com/v1/chat/completions',
    getHeaders(apiKey) { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }; },
    getEndpoint(endpoint) { return endpoint || this.defaultEndpoint; },
    buildRequestBody(model, messages, options = {}) { return { model: model || this.defaultModel, messages, max_tokens: options.maxTokens || 1000, temperature: options.temperature || 0.7 }; },
    parseResponse(data) { if (data.choices && data.choices.length > 0) return data.choices[0].message.content; throw new Error('No response from DeepSeek'); },
    validateConfig(config) { if (!config.apiKey) throw new Error('DeepSeek API key is required'); return true; }
};
