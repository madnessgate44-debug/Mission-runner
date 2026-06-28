export const HuggingFaceProvider = {
    name: 'Hugging Face',
    defaultModel: 'microsoft/DialoGPT-medium',
    defaultEndpoint: 'https://api-inference.huggingface.co/models',
    getHeaders(apiKey) { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }; },
    getEndpoint(endpoint, model) { const base = endpoint || this.defaultEndpoint; return base + '/' + model; },
    buildRequestBody(model, messages, options = {}) { const input = messages.map(m => m.content).join('\n'); return { inputs: input, parameters: { max_new_tokens: options.maxTokens || 1000, temperature: options.temperature || 0.7, return_full_text: false }, options: { wait_for_model: true } }; },
    parseResponse(data) { if (Array.isArray(data) && data.length > 0) { if (data[0].generated_text) return data[0].generated_text; if (data[0].message) return data[0].message.content; return data[0].generated_text || JSON.stringify(data[0]); } if (data.generated_text) return data.generated_text; if (data.message) return data.message.content; throw new Error('No response from Hugging Face'); },
    validateConfig(config) { if (!config.apiKey) throw new Error('Hugging Face API key is required'); return true; }
};
