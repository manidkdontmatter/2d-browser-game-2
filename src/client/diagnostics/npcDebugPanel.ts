// Renders the top-left DOM overlay for explicit NPC test spawning controls.
import { DEBUG_NPC_SPAWN_DEFAULT_COUNT } from '../../shared/net/debugRequests.js';

export interface NpcDebugPanelOptions {
  spawnNpcs: (count: number) => Promise<{ spawned: number; requested: number }>;
  setInvincible: (enabled: boolean) => Promise<{ enabled: boolean }>;
}

export class NpcDebugPanel {
  private readonly element: HTMLDivElement;
  private readonly countInput: HTMLInputElement;
  private readonly spawnButton: HTMLButtonElement;
  private readonly invincibleButton: HTMLButtonElement;
  private readonly status: HTMLSpanElement;
  private invincibleEnabled = false;

  constructor(private readonly options: NpcDebugPanelOptions) {
    this.element = document.createElement('div');
    this.element.className = 'npc-debug-panel';
    this.element.appendChild(sectionTitle('NPC Debug'));

    const row = document.createElement('div');
    row.className = 'npc-debug-row';

    this.countInput = document.createElement('input');
    this.countInput.className = 'npc-debug-input';
    this.countInput.type = 'number';
    this.countInput.min = '0';
    this.countInput.step = '1';
    this.countInput.value = String(DEBUG_NPC_SPAWN_DEFAULT_COUNT);
    this.countInput.title = 'NPC count';

    this.spawnButton = document.createElement('button');
    this.spawnButton.type = 'button';
    this.spawnButton.className = 'npc-debug-button';
    this.spawnButton.textContent = 'Spawn';
    this.spawnButton.addEventListener('click', () => {
      void this.spawn();
    });

    row.append(this.countInput, this.spawnButton);
    this.element.appendChild(row);

    this.invincibleButton = document.createElement('button');
    this.invincibleButton.type = 'button';
    this.invincibleButton.className = 'npc-debug-button npc-debug-toggle-button';
    this.invincibleButton.textContent = 'Invincible: OFF';
    this.invincibleButton.addEventListener('click', () => {
      void this.toggleInvincible();
    });
    this.element.appendChild(this.invincibleButton);

    this.status = document.createElement('span');
    this.status.className = 'npc-debug-status diagnostics-neutral';
    this.status.textContent = '0 NPCs at boot';
    this.element.appendChild(this.status);

    document.body.appendChild(this.element);
  }

  private async spawn(): Promise<void> {
    const count = clampCount(Number(this.countInput.value));
    this.countInput.value = String(count);
    this.spawnButton.disabled = true;
    this.status.textContent = 'spawning...';
    this.status.className = 'npc-debug-status diagnostics-neutral';

    try {
      const response = await this.options.spawnNpcs(count);
      this.status.textContent = `spawned ${response.spawned}/${response.requested}`;
      this.status.className = response.spawned === response.requested ? 'npc-debug-status diagnostics-ok' : 'npc-debug-status diagnostics-warn';
    } catch {
      this.status.textContent = 'spawn failed';
      this.status.className = 'npc-debug-status diagnostics-bad';
    } finally {
      this.spawnButton.disabled = false;
    }
  }

  private async toggleInvincible(): Promise<void> {
    const requested = !this.invincibleEnabled;
    this.invincibleButton.disabled = true;
    this.status.textContent = requested ? 'enabling invincible...' : 'disabling invincible...';
    this.status.className = 'npc-debug-status diagnostics-neutral';

    try {
      const response = await this.options.setInvincible(requested);
      this.invincibleEnabled = response.enabled;
      this.invincibleButton.textContent = `Invincible: ${response.enabled ? 'ON' : 'OFF'}`;
      this.status.textContent = response.enabled ? 'invincible enabled' : 'invincible disabled';
      this.status.className = response.enabled ? 'npc-debug-status diagnostics-ok' : 'npc-debug-status diagnostics-warn';
    } catch {
      this.status.textContent = 'invincible toggle failed';
      this.status.className = 'npc-debug-status diagnostics-bad';
    } finally {
      this.invincibleButton.disabled = false;
    }
  }
}

function sectionTitle(text: string): HTMLDivElement {
  const title = document.createElement('div');
  title.className = 'diagnostics-section';
  title.textContent = text;
  return title;
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) {
    return DEBUG_NPC_SPAWN_DEFAULT_COUNT;
  }

  return Math.max(0, Math.floor(value));
}
