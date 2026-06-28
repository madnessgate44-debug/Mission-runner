export class ChatManager {
    constructor() {
        this.history = [];
        this.context = {};
    }
    addMessage(role, content) { this.history.push({ role, content, timestamp: Date.now() }); }
    getHistory() { return this.history; }
    clearHistory() { this.history = []; }
    setContext(context) { this.context = context; }
    getContext() { return this.context; }
}
export function createChatManager() { return new ChatManager(); }
