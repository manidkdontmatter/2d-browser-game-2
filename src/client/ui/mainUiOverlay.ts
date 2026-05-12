// Owns the fullscreen in-game menu surface that is opened by the central UI state controller.
// This overlay is intentionally a durable shell rather than a fake data screen: it provides
// section navigation, focus restoration, and a stable content region for future character,
// inventory, ability, creator, and settings panels. Until those gameplay systems expose
// real client-readable state, each section renders a quiet placeholder so the UI does not
// imply mechanics or diagnostics that do not exist yet.
import { ExclusiveUiScreen } from './uiStateController.js';

type MainUiSectionKey = 'character' | 'inventory' | 'abilities' | 'ability-creator' | 'settings';

interface MainUiSectionDefinition {
  key: MainUiSectionKey;
  label: string;
}

const MAIN_UI_SECTIONS: readonly MainUiSectionDefinition[] = [
  { key: 'character', label: 'Character' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'abilities', label: 'Abilities' },
  { key: 'ability-creator', label: 'Ability Creator' },
  { key: 'settings', label: 'Settings' },
];

export class MainUiOverlay {
  readonly screen = ExclusiveUiScreen.MainMenu;
  private readonly element: HTMLDivElement;
  private readonly sectionButtons = new Map<MainUiSectionKey, HTMLButtonElement>();
  private readonly sectionTitle = document.createElement('h1');
  private readonly content = document.createElement('section');
  private activeSectionKey: MainUiSectionKey = 'character';
  private open = false;
  private previousFocus: HTMLElement | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'main-ui-overlay';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Game menu');
    this.element.setAttribute('aria-hidden', 'true');
    this.element.hidden = true;
    this.element.style.display = 'none';

    const backdrop = document.createElement('div');
    backdrop.className = 'main-ui-backdrop';

    const shell = document.createElement('div');
    shell.className = 'main-ui-shell';
    shell.append(this.createNavigation(), this.createPanel());

    this.element.append(backdrop, shell);
    document.body.appendChild(this.element);

    this.activateSection(this.activeSectionKey);
  }

  setOpen(open: boolean): void {
    if (this.open === open) {
      return;
    }

    if (open) {
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    this.open = open;
    this.element.hidden = !open;
    this.element.style.display = open ? 'flex' : 'none';
    this.element.setAttribute('aria-hidden', open ? 'false' : 'true');

    if (open) {
      queueMicrotask(() => {
        this.sectionButtons.get(this.activeSectionKey)?.focus();
      });
      return;
    }

    this.previousFocus?.focus();
    this.previousFocus = null;
  }

  private createNavigation(): HTMLElement {
    const nav = document.createElement('nav');
    nav.className = 'main-ui-nav';
    nav.setAttribute('aria-label', 'Game menu sections');

    const heading = document.createElement('div');
    heading.className = 'main-ui-nav-heading';
    heading.textContent = 'Menu';

    const sectionList = document.createElement('div');
    sectionList.className = 'main-ui-section-list';

    for (const section of MAIN_UI_SECTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'main-ui-section-button';
      button.textContent = section.label;
      button.addEventListener('click', () => this.activateSection(section.key));

      this.sectionButtons.set(section.key, button);
      sectionList.appendChild(button);
    }

    const shortcut = document.createElement('div');
    shortcut.className = 'main-ui-shortcut';
    shortcut.append(this.createShortcutKey(), document.createTextNode('Close'));

    nav.append(heading, sectionList, shortcut);
    return nav;
  }

  private createShortcutKey(): HTMLElement {
    const key = document.createElement('span');
    key.className = 'main-ui-shortcut-key';
    key.textContent = '~';
    return key;
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement('main');
    panel.className = 'main-ui-panel';

    const header = document.createElement('header');
    header.className = 'main-ui-panel-header';

    this.sectionTitle.className = 'main-ui-panel-title';
    header.appendChild(this.sectionTitle);

    this.content.className = 'main-ui-content';
    this.content.setAttribute('aria-live', 'polite');

    panel.append(header, this.content);
    return panel;
  }

  private activateSection(key: MainUiSectionKey): void {
    const section = MAIN_UI_SECTIONS.find((entry) => entry.key === key);
    if (!section) {
      return;
    }

    this.activeSectionKey = key;
    this.sectionTitle.textContent = section.label;

    for (const [sectionKey, button] of this.sectionButtons) {
      const active = sectionKey === key;
      button.dataset.active = active ? 'true' : 'false';
      if (active) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    }

    this.content.replaceChildren(this.createPlaceholder());
  }

  private createPlaceholder(): HTMLElement {
    const placeholder = document.createElement('div');
    placeholder.className = 'main-ui-placeholder';
    placeholder.textContent = 'To be implemented';
    return placeholder;
  }
}
