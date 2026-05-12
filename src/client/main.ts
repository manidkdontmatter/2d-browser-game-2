// Boots the browser client, renderer, input collection, coordinated UI state, nengi connection, and render loop.
import './styles.css';
import { GameRenderer } from './rendering/gameRenderer.js';
import { ClientInputMode, InputController } from './input.js';
import { ClientConnection } from './net/clientConnection.js';
import { ClientWorldState } from './game/clientWorldState.js';
import { AttackIntent } from '../shared/domain/commands.js';
import { ClientDiagnostics } from './diagnostics/clientDiagnostics.js';
import { DiagnosticsPanel } from './diagnostics/diagnosticsPanel.js';
import { NpcDebugPanel } from './diagnostics/npcDebugPanel.js';
import { CommandStream } from './net/commandStream.js';
import { AlertSystem } from './ui/alertSystem.js';
import { MainUiOverlay } from './ui/mainUiOverlay.js';
import { UiStateController } from './ui/uiStateController.js';

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

const root = document.querySelector<HTMLElement>('#game-root')!;
if (!root) {
  throw new Error('Missing #game-root');
}

void boot();

async function boot(): Promise<void> {
  const state = new ClientWorldState();
  const diagnostics = new ClientDiagnostics(state);
  const renderer = new GameRenderer(state);
  await renderer.mount(root);
  const input = new InputController(renderer.app.canvas);
  const uiState = new UiStateController({
    setInputMode: (mode) => input.setMode(mode),
  });
  const mainUi = new MainUiOverlay();
  uiState.registerExclusiveSurface(mainUi);

  const cursor = document.createElement('div');
  cursor.className = 'game-cursor';
  document.body.appendChild(cursor);

  const connection = new ClientConnection(state, diagnostics);
  mainUi.setConnection(connection);
  const commandStream = new CommandStream(
    connection,
    diagnostics,
    () => input.getMode(),
    () => input.consumeAttack(),
  );
  connection.onMapTransferStarted = () => {
    commandStream.reset();
  };
  const diagnosticsPanel = new DiagnosticsPanel(diagnostics, {
    getClientSidePredictionEnabled: () => connection.isClientSidePredictionEnabled(),
    setClientSidePredictionEnabled: (enabled) => connection.setClientSidePredictionEnabled(enabled),
    getCameraZoom: () => renderer.getCameraZoom(),
  });
  new NpcDebugPanel({
    spawnNpcs: (count) => connection.spawnDebugNpcs(count),
    setInvincible: (enabled) => connection.setDebugInvincible(enabled),
  });
  const alertSystem = new AlertSystem();
  let nextTestAlertAtMs = performance.now() + 30000;

  window.addEventListener('keydown', (event) => uiState.handleGlobalKeyDown(event));
  void connection.connect(resolveInitialMapWebSocketUrl());
  let previousTickAtMs = performance.now();

  function tick(): void {
    const nowMs = performance.now();
    const elapsedMs = Math.max(0, nowMs - previousTickAtMs);
    previousTickAtMs = nowMs;
    diagnostics.recordFrame(nowMs);
    alertSystem.tick(nowMs);
    if (nowMs >= nextTestAlertAtMs) {
      alertSystem.show('Test alert — the alert system is working.');
      nextTestAlertAtMs = nowMs + 30000;
    }
    connection.pump(nowMs);

    if (input.getMode() === ClientInputMode.Gameplay) {
      const aim = renderer.screenToWorld(input.state.mouseX, input.state.mouseY);
      if (input.state.attack === AttackIntent.Melee) {
        renderer.showMeleeDiagnostic(aim.x, aim.y, nowMs);
      }
      commandStream.update(input.state, aim.x, aim.y, nowMs, elapsedMs);
    } else {
      commandStream.update(input.state, 0, 0, nowMs, elapsedMs);
    }

    commandStream.flushIfNeeded();
    const localPresentation = connection.getLocalPresentationPosition(nowMs);
    renderer.render(localPresentation, nowMs);
    cursor.style.transform = `translate(${input.state.mouseX}px, ${input.state.mouseY}px)`;
    diagnosticsPanel.update(nowMs);
  }

  renderer.app.ticker.add(tick);

  window.render_game_to_text = () => renderer.renderGameToText();
  window.advanceTime = (ms: number) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) {
      tick();
    }
  };
}

function resolveInitialMapWebSocketUrl(): string {
  const configuredUrl = import.meta.env.VITE_GAME_WS_URL as string | undefined;
  if (configuredUrl) {
    return configuredUrl;
  }

  const isLocalDevHost = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
  if (isLocalDevHost) {
    return 'ws://127.0.0.1:9001';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/test-map-a`;
}
