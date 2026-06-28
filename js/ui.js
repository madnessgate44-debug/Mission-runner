export class UIManager {
    constructor() {
        this.elements = {};
        this.theme = 'dark';
    }
    registerElement(id, element) { this.elements[id] = element; }
    getElement(id) { return this.elements[id] || document.getElementById(id); }
    showProgress(percentage, message) {
        const bar = this.getElement('progressFill');
        const status = this.getElement('progressStatus');
        if (bar) bar.style.width = percentage + '%';
        if (status) { status.textContent = message; status.style.display = 'block'; }
    }
    hideProgress() {
        const bar = this.getElement('progressBar');
        const status = this.getElement('progressStatus');
        if (bar) bar.classList.remove('active');
        if (status) status.style.display = 'none';
    }
    setTheme(theme) { this.theme = theme; document.body.className = theme; }
    toggleSidebar() { const sidebar = this.getElement('sidebar'); if (sidebar) sidebar.classList.toggle('open'); }
    addMessage(container, message, type) {
        const d = document.createElement('div');
        const classes = { user: 'message user', wizard: 'message wizard', system: 'message ai', error: 'message ai error', success: 'message ai success', warning: 'message ai warning' };
        d.className = classes[type] || 'message ai';
        d.innerHTML = message.replace(/\n/g, '<br>');
        if (container) { container.appendChild(d); d.scrollIntoView({ behavior: 'smooth' }); }
        return d;
    }
}
export function createUIManager() { return new UIManager(); }
