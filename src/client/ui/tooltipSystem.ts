// Singleton tooltip manager. All tooltips in the game flow through this module so
// only one tooltip is ever visible, it always appears on top of every UI layer
// (z-index just below the custom game cursor), and positioning is consistently
// clamped to the viewport.

const TOOLTIP_GAP = 14;
const TOOLTIP_Z = 2147483646;

type ContentFactory = () => HTMLElement;

class TooltipSystem {
  private readonly el: HTMLDivElement;
  private currentOwner: HTMLElement | null = null;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'game-tooltip';
    this.el.style.display = 'none';
    document.body.appendChild(this.el);
  }

  // Attach a simple text tooltip to an element. The tooltip follows the cursor
  // while hovering over the element and hides on mouseleave.
  attachText(el: HTMLElement, text: string): void {
    el.dataset.tooltip = text;
    const onEnter = () => {
      this.clearHideTimeout();
      if (this.currentOwner !== el) {
        this.removeContent();
      }
      this.currentOwner = el;
      this.el.textContent = text;
      this.el.style.display = '';
    };
    const onMove = (e: MouseEvent) => this.reposition(e.clientX, e.clientY);
    const onLeave = () => this.scheduleHide(el);
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
  }

  // Show a rich-HTML tooltip owned by an element. The caller is responsible for
  // hiding it via hide(owner) when the cursor leaves.
  showRich(owner: HTMLElement, buildContent: ContentFactory, clientX: number, clientY: number): void {
    this.clearHideTimeout();
    if (this.currentOwner !== owner) {
      this.removeContent();
    }
    this.currentOwner = owner;
    this.el.appendChild(buildContent());
    this.el.style.display = '';
    this.reposition(clientX, clientY);
  }

  // Owners must call hide when their trigger element is left.
  hide(owner: HTMLElement): void {
    if (this.currentOwner !== owner) return;
    this.scheduleHide(owner);
  }

  reposition(clientX: number, clientY: number): void {
    // Position near the cursor, clamped to keep the tooltip fully in view.
    // Prefer right-and-down from cursor; flip when near an edge.
    const nextX = clientX + TOOLTIP_GAP;
    const nextY = clientY + TOOLTIP_GAP;

    // Measure lazily — the element may have changed content since last frame.
    const rect = this.el.getBoundingClientRect();
    const w = rect.width || this.el.offsetWidth || 200;
    const h = rect.height || this.el.offsetHeight || 40;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const x = nextX + w > vw ? clientX - TOOLTIP_GAP - w : nextX;
    const y = nextY + h > vh ? clientY - TOOLTIP_GAP - h : nextY;

    this.el.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  }

  // ---- internal helpers ----------------------------------------------------

  private removeContent(): void {
    while (this.el.firstChild) {
      this.el.firstChild.remove();
    }
  }

  private scheduleHide(owner: HTMLElement): void {
    // Tiny delay so a quick mouseleave→mouseenter on an adjacent element
    // doesn't flash the tooltip.
    this.clearHideTimeout();
    this.hideTimeout = setTimeout(() => {
      if (this.currentOwner === owner) {
        this.el.style.display = 'none';
        this.removeContent();
        this.currentOwner = null;
      }
    }, 60);
  }

  private clearHideTimeout(): void {
    if (this.hideTimeout !== null) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }
}

export const tooltipSystem = new TooltipSystem();

// Convenience: bind a simple text tooltip to an element.
export function bindTooltip(el: HTMLElement, text: string): void {
  tooltipSystem.attachText(el, text);
}
