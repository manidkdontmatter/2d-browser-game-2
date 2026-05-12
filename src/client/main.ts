// Boots the browser client, renderer, input collection, coordinated UI state, nengi connection, and render loop.
import './styles.css';
import { GameRenderer } from './rendering/gameRenderer.js';
import { ClientInputMode, InputCommandSampler, InputController } from './input.js';
import { ClientConnection } from './net/clientConnection.js';
import { ClientWorldState } from './game/clientWorldState.js';
import { AttackIntent } from '../shared/domain/commands.js';
import { ClientDiagnostics } from './diagnostics/clientDiagnostics.js';
import { DiagnosticsPanel } from './diagnostics/diagnosticsPanel.js';
import { NpcDebugPanel } from './diagnostics/npcDebugPanel.js';
import { MainUiOverlay } from './ui/mainUiOverlay.js';
import { UiStateController } from './ui/uiStateController.js';
import { CLIENT_COMMAND_PACKET_INTERVAL_MS, MOVEMENT_COMMAND_INTERVAL_MS, NET_TIMING } from '../shared/net/timing.js';

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

const root = document.querySelector<HTMLElement>('#game-root');
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
  uiState.registerExclusiveSurface(new MainUiOverlay());

  let inputSampler = new InputCommandSampler();
  const connection = new ClientConnection(state, diagnostics, {
    onMapTransferStarted: () => {
      inputSampler = new InputCommandSampler();
    },
  });
  const diagnosticsPanel = new DiagnosticsPanel(diagnostics, {
    getClientSidePredictionEnabled: () => connection.isClientSidePredictionEnabled(),
    setClientSidePredictionEnabled: (enabled) => connection.setClientSidePredictionEnabled(enabled),
  });
  new NpcDebugPanel({
    spawnNpcs: (count) => connection.spawnDebugNpcs(count),
    setInvincible: (enabled) => connection.setDebugInvincible(enabled),
  });
  window.addEventListener('keydown', (event) => uiState.handleGlobalKeyDown(event));
  void connection.connect(resolveInitialMapWebSocketUrl());
  let previousTickAtMs = performance.now();
  let inputCommandAccumulatorMs = 0;
  let outboundFlushAccumulatorMs = 0;

  function tick(): void {
    const nowMs = performance.now();
    const elapsedMs = Math.max(0, nowMs - previousTickAtMs);
    previousTickAtMs = nowMs;
    outboundFlushAccumulatorMs = Math.min(
      outboundFlushAccumulatorMs + elapsedMs,
      CLIENT_COMMAND_PACKET_INTERVAL_MS,
    );
    diagnostics.recordFrame();
    connection.pump();

    if (input.getMode() === ClientInputMode.Gameplay) {
      inputCommandAccumulatorMs = Math.min(
        inputCommandAccumulatorMs + elapsedMs,
        MOVEMENT_COMMAND_INTERVAL_MS * NET_TIMING.maxClientInputCommandsPerFrame,
      );
      const aim = renderer.screenToWorld(input.state.mouseX, input.state.mouseY);
      const attack = input.state.attack;
      if (attack === AttackIntent.Melee) {
        renderer.showMeleeDiagnostic(aim.x, aim.y);
      }

      let commandsCreatedThisFrame = 0;
      let attackConsumedThisFrame = false;
      while (
        inputCommandAccumulatorMs >= MOVEMENT_COMMAND_INTERVAL_MS
        && commandsCreatedThisFrame < NET_TIMING.maxClientInputCommandsPerFrame
      ) {
        const commandAttack = attackConsumedThisFrame ? AttackIntent.None : input.state.attack;
        const command = inputSampler.sample(input.state, aim.x, aim.y, commandAttack, nowMs);
        diagnostics.recordInputSample(nowMs);
        if (inputSampler.shouldSend(command, nowMs) && connection.queueCommand(command)) {
          inputSampler.markSent(command, nowMs);
          if (commandAttack !== AttackIntent.None) {
            input.consumeAttack();
            attackConsumedThisFrame = true;
          }
        }

        inputCommandAccumulatorMs -= MOVEMENT_COMMAND_INTERVAL_MS;
        commandsCreatedThisFrame += 1;
      }
    } else {
      inputCommandAccumulatorMs = 0;
    }

    if (outboundFlushAccumulatorMs >= CLIENT_COMMAND_PACKET_INTERVAL_MS) {
      connection.flushOutbound();
      outboundFlushAccumulatorMs = 0;
    }

    const localPresentation = connection.getLocalPresentationPosition(input.state, nowMs);
    renderer.render(input.state.mouseX, input.state.mouseY, localPresentation);
    diagnosticsPanel.update();
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
