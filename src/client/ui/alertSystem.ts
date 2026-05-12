// Alert message UI — bottom-right toast-style notifications that fade after a few seconds.
const ALERT_LIFETIME_MS = 5000;
const ALERT_MAX_VISIBLE = 5;

interface AlertEntry {
  element: HTMLDivElement;
  removeAtMs: number;
}

export class AlertSystem {
  private readonly container: HTMLDivElement;
  private readonly entries: AlertEntry[] = [];

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'alert-container';
    this.container.setAttribute('role', 'status');
    this.container.setAttribute('aria-live', 'polite');
    this.container.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(this.container);
  }

  show(message: string): void {
    const now = performance.now();
    this.prune(now);

    const el = document.createElement('div');
    el.className = 'alert-item';
    el.textContent = message;
    this.container.appendChild(el);

    // Trigger enter animation
    requestAnimationFrame(() => {
      el.dataset.visible = 'true';
    });

    this.entries.push({ element: el, removeAtMs: now + ALERT_LIFETIME_MS });

    // Keep at most N alerts
    while (this.entries.length > ALERT_MAX_VISIBLE) {
      this.dismissEntry(this.entries[0]);
    }
  }

  tick(nowMs: number): void {
    this.prune(nowMs);
  }

  private prune(nowMs: number): void {
    while (this.entries.length > 0 && this.entries[0].removeAtMs <= nowMs) {
      this.dismissEntry(this.entries[0]);
    }
  }

  private dismissEntry(entry: AlertEntry): void {
    entry.element.dataset.visible = 'false';
    const el = entry.element;
    const idx = this.entries.indexOf(entry);
    if (idx >= 0) {
      this.entries.splice(idx, 1);
    }
    el.addEventListener('transitionend', () => {
      el.remove();
    });
    // Fallback removal if transitionend doesn't fire
    setTimeout(() => el.remove(), 600);
  }
}
