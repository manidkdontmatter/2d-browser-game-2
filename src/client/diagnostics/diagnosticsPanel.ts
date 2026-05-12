// Renders the top-right DOM overlay for client performance and netcode diagnostics.
import { ClientDiagnostics, DiagnosticsSnapshot } from './clientDiagnostics.js';

export interface DiagnosticsPanelOptions {
  getClientSidePredictionEnabled?: () => boolean;
  setClientSidePredictionEnabled?: (enabled: boolean) => void;
  getCameraZoom?: () => number;
}

export class DiagnosticsPanel {
  private readonly element: HTMLDivElement;
  private readonly rows = new Map<string, HTMLSpanElement>();
  private cspToggle: HTMLButtonElement | null = null;
  private lastRenderAtMs = 0;

  constructor(
    private readonly diagnostics: ClientDiagnostics,
    private readonly options: DiagnosticsPanelOptions = {},
  ) {
    this.element = document.createElement('div');
    this.element.className = 'diagnostics-panel';
    this.element.appendChild(sectionTitle('Client'));
    this.addRow('fps', 'FPS');
    this.addRow('frame', 'Frame ms');
    this.addRow('connected', 'Connected');
    this.element.appendChild(sectionTitle('Net'));
    this.addRow('serverFrames', 'Server frames/s');
    this.addRow('inputSamples', 'Command samples/s');
    this.addRow('commands', 'Commands queued/s');
    this.addRow('accepted', 'Confirmed packets/s');
    this.addRow('sentSeq', 'Latest queued seq');
    this.addRow('sentTick', 'Latest queued packet');
    this.addRow('confirmedTick', 'Latest confirmed packet');
    this.addRow('pending', 'Pending replay commands');
    this.addRow('predictionErrors', 'Prediction errors/s');
    this.addRow('predictionReplays', 'Prediction replays/s');
    this.addToggleRow('csp', 'CSP');
    this.addRow('lastServerFrame', 'Last server frame age');
    this.element.appendChild(sectionTitle('Replication'));
    this.addRow('entities', 'Entities');
    this.addRow('creates', 'Creates/s');
    this.addRow('updates', 'Updates/s');
    this.addRow('deletes', 'Deletes/s');
    this.element.appendChild(sectionTitle('World'));
    this.addRow('localEntity', 'Player entity id');
    this.addRow('position', 'Player xy');
    this.addRow('map', 'Map');
    this.addRow('mapReady', 'Map ready');
    this.addRow('seed', 'Seed');
    this.addRow('zoom', 'Zoom');
    document.body.appendChild(this.element);
  }

  update(nowMs = performance.now()): void {
    if (nowMs - this.lastRenderAtMs < 100) {
      return;
    }
    this.lastRenderAtMs = nowMs;
    this.render(this.diagnostics.snapshot(nowMs));
  }

  private render(snapshot: DiagnosticsSnapshot): void {
    this.setRow('fps', whole(snapshot.fps), statusForFps(snapshot.fps));
    this.setRow('frame', `${fixed(snapshot.averageFrameMs)} / ${fixed(snapshot.maxFrameMs)}`, statusForFrame(snapshot.maxFrameMs));
    this.setRow('connected', snapshot.connected ? 'yes' : 'no', snapshot.connected ? 'ok' : 'bad');
    this.setRow('serverFrames', fixed(snapshot.serverFramesPerSecond), statusForServerFrameRate(snapshot.serverFramesPerSecond));
    this.setRow('inputSamples', fixed(snapshot.inputSamplesPerSecond), 'neutral');
    this.setRow('commands', fixed(snapshot.commandsQueuedPerSecond), 'neutral');
    this.setRow('accepted', fixed(snapshot.commandsAcceptedPerSecond), 'neutral');
    this.setRow('sentSeq', whole(snapshot.latestSentSequence), 'neutral');
    this.setRow('sentTick', whole(snapshot.latestSentClientTick), 'neutral');
    this.setRow('confirmedTick', whole(snapshot.latestConfirmedClientTick), tickStatus(snapshot.latestSentClientTick, snapshot.latestConfirmedClientTick));
    this.setRow('pending', whole(snapshot.pendingCommands), snapshot.pendingCommands > 30 ? 'warn' : 'neutral');
    this.setRow('predictionErrors', fixed(snapshot.predictionErrorsPerSecond), snapshot.predictionErrorsPerSecond > 0 ? 'warn' : 'neutral');
    this.setRow('predictionReplays', fixed(snapshot.predictionReplaysPerSecond), 'neutral');
    this.setToggle('csp', this.options.getClientSidePredictionEnabled?.() ?? false);
    this.setRow('lastServerFrame', formatAge(snapshot.lastServerFrameAgeMs), statusForServerAge(snapshot.lastServerFrameAgeMs));
    this.setRow('entities', whole(snapshot.entityCount), 'neutral');
    this.setRow('creates', fixed(snapshot.entityCreatesPerSecond), 'neutral');
    this.setRow('updates', fixed(snapshot.entityUpdatesPerSecond), 'neutral');
    this.setRow('deletes', fixed(snapshot.entityDeletesPerSecond), 'neutral');
    this.setRow('localEntity', snapshot.localEntityId === 0 ? '-' : String(snapshot.localEntityId), snapshot.localEntityId === 0 ? 'warn' : 'ok');
    this.setRow('position', formatPosition(snapshot.playerX, snapshot.playerY), snapshot.playerX === null ? 'warn' : 'neutral');
    this.setRow('map', snapshot.mapName || snapshot.mapId || '-', snapshot.mapId ? 'ok' : 'warn');
    this.setRow('mapReady', snapshot.mapReady ? 'yes' : 'no', snapshot.mapReady ? 'ok' : 'warn');
    this.setRow('seed', snapshot.worldSeed ?? '-', 'neutral');
    this.setRow('zoom', (this.options.getCameraZoom?.() ?? 1).toFixed(2), 'neutral');
  }

  private addRow(id: string, label: string): void {
    const row = document.createElement('div');
    row.className = 'diagnostics-row';
    const labelElement = document.createElement('span');
    labelElement.className = 'diagnostics-label';
    labelElement.textContent = label;
    const valueElement = document.createElement('span');
    valueElement.className = 'diagnostics-value diagnostics-neutral';
    valueElement.textContent = '-';
    row.append(labelElement, valueElement);
    this.rows.set(id, valueElement);
    this.element.appendChild(row);
  }

  private addToggleRow(id: string, label: string): void {
    const row = document.createElement('div');
    row.className = 'diagnostics-row';
    const labelElement = document.createElement('span');
    labelElement.className = 'diagnostics-label';
    labelElement.textContent = label;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'diagnostics-toggle diagnostics-neutral';
    button.textContent = '-';
    button.addEventListener('click', () => {
      const current = this.options.getClientSidePredictionEnabled?.() ?? false;
      this.options.setClientSidePredictionEnabled?.(!current);
      this.setToggle(id, !current);
    });
    row.append(labelElement, button);
    this.cspToggle = button;
    this.element.appendChild(row);
  }

  private setRow(id: string, value: string, status: DiagnosticStatus): void {
    const row = this.rows.get(id);
    if (!row) {
      return;
    }
    row.textContent = value;
    row.className = `diagnostics-value diagnostics-${status}`;
  }

  private setToggle(id: string, enabled: boolean): void {
    if (id !== 'csp' || !this.cspToggle) {
      return;
    }

    this.cspToggle.textContent = enabled ? 'on' : 'off';
    this.cspToggle.className = `diagnostics-toggle diagnostics-${enabled ? 'ok' : 'warn'}`;
  }
}

type DiagnosticStatus = 'ok' | 'warn' | 'bad' | 'neutral';

function sectionTitle(text: string): HTMLDivElement {
  const title = document.createElement('div');
  title.className = 'diagnostics-section';
  title.textContent = text;
  return title;
}

function fixed(value: number): string {
  return value.toFixed(1);
}

function whole(value: number): string {
  return Math.round(value).toString();
}

function formatAge(ageMs: number | null): string {
  return ageMs === null ? '-' : `${Math.round(ageMs)}ms`;
}

function formatPosition(x: number | null, y: number | null): string {
  return x === null || y === null ? '-' : `${Math.round(x)}, ${Math.round(y)}`;
}

function statusForFps(fps: number): DiagnosticStatus {
  if (fps >= 50) return 'ok';
  if (fps >= 30) return 'warn';
  return 'bad';
}

function statusForFrame(maxFrameMs: number): DiagnosticStatus {
  if (maxFrameMs <= 24) return 'ok';
  if (maxFrameMs <= 40) return 'warn';
  return 'bad';
}

function statusForServerFrameRate(rate: number): DiagnosticStatus {
  if (rate >= 25) return 'ok';
  if (rate >= 10) return 'warn';
  return 'bad';
}

function statusForServerAge(ageMs: number | null): DiagnosticStatus {
  if (ageMs === null) return 'warn';
  if (ageMs <= 150) return 'ok';
  if (ageMs <= 500) return 'warn';
  return 'bad';
}

function tickStatus(sent: number, confirmed: number): DiagnosticStatus {
  if (sent === 0) return 'neutral';
  return confirmed >= sent ? 'ok' : 'warn';
}
