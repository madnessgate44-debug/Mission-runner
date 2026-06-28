export function getProvider(name) {
    const providers = {
        openai: { name: 'OpenAI', defaultModel: 'gpt-3.5-turbo', defaultEndpoint: 'https://api.openai.com/v1/chat/completions' },
        deepseek: { name: 'DeepSeek', defaultModel: 'deepseek-chat', defaultEndpoint: 'https://api.deepseek.com/v1/chat/completions' },
        gemini: { name: 'Gemini', defaultModel: 'gemini-pro', defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models' },
        huggingface: { name: 'Hugging Face', defaultModel: 'microsoft/DialoGPT-medium', defaultEndpoint: 'https://api-inference.huggingface.co/models' },
        custom: { name: 'Custom', defaultModel: 'default', defaultEndpoint: 'https://api.openai.com/v1/chat/completions' }
    };
    return providers[name] || providers.custom;
}
