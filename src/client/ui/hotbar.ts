// Renders and manages the persistent bottom-screen hotbar for items and abilities.
// Slots 0-1 are LMB/RMB, slots 2-11 are numeric keys 0-9.
// Assignment is server-authoritative: drops send a SetHotbarSlot request and the
// server response updates the cached state via InventoryStore.
import { HOTBAR_SLOT_COUNT, type InventoryStore } from './inventoryStore.js';
import { tooltipSystem } from './tooltipSystem.js';

const HOTBAR_KEY_LABELS = ['LMB', 'RMB', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export type HotbarSetSlotFn = (
  slotIndex: number,
  inventorySlotIndex: number | null,
  abilityId: string | null,
) => void;

export class Hotbar {
  readonly element: HTMLDivElement;
  private readonly slotElements: HTMLDivElement[] = [];

  constructor(
    private readonly store: InventoryStore,
    private readonly onSetSlot: HotbarSetSlotFn,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'hotbar';

    for (let i = 0; i < HOTBAR_SLOT_COUNT; i += 1) {
      const slot = this.createSlot(i);
      this.slotElements.push(slot);
      this.element.appendChild(slot);

      if (i === 1) {
        const divider = document.createElement('div');
        divider.className = 'hotbar-divider';
        this.element.appendChild(divider);
      }
    }

    document.body.appendChild(this.element);
    this.store.addListener(() => this.render());
    this.render();
  }

  private createSlot(index: number): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'hotbar-slot';
    el.dataset.lmb = index === 0 ? 'true' : 'false';
    el.dataset.rmb = index === 1 ? 'true' : 'false';

    const key = document.createElement('span');
    key.className = 'hotbar-slot-key';
    key.textContent = HOTBAR_KEY_LABELS[index] ?? '';

    const content = document.createElement('div');
    content.className = 'hotbar-slot-content';

    el.append(key, content);

    // Tooltips
    el.addEventListener('mouseenter', (event) => {
      const item = this.store.getHotbarItem(index);
      if (item) {
        tooltipSystem.showRich(el, () => this.buildItemTooltip(item.definition), event.clientX, event.clientY);
      } else {
        const slot = this.store.getHotbarSlot(index);
        if (slot?.abilityId) {
          tooltipSystem.showRich(el, () => this.buildAbilityTooltip(slot.abilityId!), event.clientX, event.clientY);
        }
      }
    });
    el.addEventListener('mousemove', (event) => {
      tooltipSystem.reposition(event.clientX, event.clientY);
    });
    el.addEventListener('mouseleave', () => {
      tooltipSystem.hide(el);
    });

    // Right-click to clear
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.onSetSlot(index, null, null);
    });

    // Drop target
    el.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'move';
      el.classList.add('hotbar-slot-dragover');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('hotbar-slot-dragover');
    });
    el.addEventListener('drop', (event) => {
      event.preventDefault();
      el.classList.remove('hotbar-slot-dragover');
      const type = event.dataTransfer!.getData('application/x-hotbar-source');
      if (type === 'inventory') {
        const raw = event.dataTransfer!.getData('application/x-inventory-slot');
        if (raw) {
          const inventorySlotIndex = Number(raw);
          if (Number.isFinite(inventorySlotIndex)) {
            this.onSetSlot(index, inventorySlotIndex, null);
          }
        }
      } else if (type === 'ability') {
        const abilityId = event.dataTransfer!.getData('application/x-ability-id');
        if (abilityId) {
          this.onSetSlot(index, null, abilityId);
        }
      }
    });

    return el;
  }

  render(): void {
    for (let i = 0; i < HOTBAR_SLOT_COUNT; i += 1) {
      const el = this.slotElements[i];
      if (!el) continue;

      const content = el.querySelector('.hotbar-slot-content');
      if (!content) continue;

      const existingName = el.querySelector('.hotbar-slot-name');
      const existingCount = el.querySelector('.hotbar-slot-count');
      const existingAbility = el.querySelector('.hotbar-slot-ability');

      // Check for inventory item first
      const item = this.store.getHotbarItem(i);
      if (item) {
        el.dataset.empty = 'false';
        el.classList.add('hotbar-slot-has-item');
        el.classList.remove('hotbar-slot-has-ability');
        existingAbility?.remove();

        const name = existingName ?? document.createElement('span');
        name.className = 'hotbar-slot-name';
        name.textContent = item.definition.name;
        if (!existingName) content.appendChild(name);

        if (item.slot.stackCount > 1) {
          const count = existingCount ?? document.createElement('span');
          count.className = 'hotbar-slot-count';
          count.textContent = String(item.slot.stackCount);
          if (!existingCount) el.appendChild(count);
        } else {
          existingCount?.remove();
        }
        continue;
      }

      // Check for ability
      const slot = this.store.getHotbarSlot(i);
      if (slot?.abilityId) {
        el.dataset.empty = 'false';
        el.classList.remove('hotbar-slot-has-item');
        el.classList.add('hotbar-slot-has-ability');
        existingName?.remove();
        existingCount?.remove();

        const ability = existingAbility ?? document.createElement('span');
        ability.className = 'hotbar-slot-ability';
        ability.textContent = slot.abilityId;
        if (!existingAbility) content.appendChild(ability);
        continue;
      }

      // Empty
      el.dataset.empty = 'true';
      el.classList.remove('hotbar-slot-has-item', 'hotbar-slot-has-ability');
      existingName?.remove();
      existingCount?.remove();
      existingAbility?.remove();
    }
  }

  private buildItemTooltip(definition: { name: string; type: string; tier: string; description: string }): HTMLElement {
    const root = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'tooltip-name';
    name.textContent = definition.name;
    const type = document.createElement('div');
    type.className = 'tooltip-type';
    type.textContent = `${definition.tier} ${definition.type}`;
    const desc = document.createElement('div');
    desc.className = 'tooltip-desc';
    desc.textContent = definition.description;
    root.append(name, type, desc);
    return root;
  }

  private buildAbilityTooltip(abilityId: string): HTMLElement {
    const root = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'tooltip-name';
    name.textContent = abilityId;
    const type = document.createElement('div');
    type.className = 'tooltip-type';
    type.textContent = 'Ability';
    root.append(name, type);
    return root;
  }
}
