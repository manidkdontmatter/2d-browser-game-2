// Connects the Pixi client to nengi and applies replicated messages/entities to rendering state.
import { Client, Interpolator } from 'nengi';
import { WebSocketClientAdapter } from 'nengi-websocket-client-adapter';
import { ncontext } from '../../shared/net/context.js';
import { DebugSetInvincibleResponse, DebugSpawnNpcsResponse } from '../../shared/net/debugRequests.js';
import type { MapTransferPayload } from '../../shared/net/messages.js';
import { quantizeInputCommandForNetwork } from '../../shared/net/commandQuantization.js';
import { NType } from '../../shared/net/nType.js';
import { RequestEndpoint } from '../../shared/net/requestEndpoints.js';
import { NET_TIMING } from '../../shared/net/timing.js';
import { ClientDiagnostics } from '../diagnostics/clientDiagnostics.js';
import { ClientEntity, ClientWorldState } from '../game/clientWorldState.js';
import { InputCommandPayload, InputState } from '../input.js';
import { MovementPredictionController, NengiReplayCommandSet, PredictionErrorFrameLike } from './movementPrediction.js';

const PREDICTED_LOCAL_PROPS = ['x', 'y', 'facing'];

export interface ClientConnectionOptions {
  onMapTransferStarted?: (transfer: MapTransferPayload) => void;
}

export class ClientConnection {
  private client: Client;
  private interpolator: Interpolator;
  private readonly movementPrediction: MovementPredictionController;
  private readonly netEntitySchema = ncontext.getSchema(NType.NetEntity);
  // nengi 2 alpha exposes prediction errors but not the old demo replay helper, so replay commands are indexed by nengi client tick here.
  private readonly replayHistory = new Map<number, InputCommandPayload[]>();
  private connected = false;
  private transferring = false;
  private hasPendingOutbound = false;
  private latestObservedServerFrameTick = 0;
  private latestRecordedConfirmedClientTick = -1;

  constructor(
    private readonly state: ClientWorldState,
    private readonly diagnostics: ClientDiagnostics,
    private readonly options: ClientConnectionOptions = {},
  ) {
    const client = createClient();
    this.client = client;
    this.interpolator = new Interpolator(client);
    this.movementPrediction = new MovementPredictionController(this.state);
  }

  async connect(url = 'ws://127.0.0.1:9001', token = 'dev'): Promise<void> {
    await this.client.connect(url, { token });
    this.connected = true;
    this.diagnostics.setConnected(true);
  }

  setClientSidePredictionEnabled(enabled: boolean): void {
    this.movementPrediction.setEnabled(enabled);
  }

  isClientSidePredictionEnabled(): boolean {
    return this.movementPrediction.isEnabled();
  }

  spawnDebugNpcs(count: number): Promise<DebugSpawnNpcsResponse> {
    if (!this.connected) {
      return Promise.reject(new Error('Client is not connected.'));
    }

    return new Promise((resolve) => {
      this.client.network.request(RequestEndpoint.DebugSpawnNpcs, { count }, (response: DebugSpawnNpcsResponse) => {
        resolve(response);
      });
      this.hasPendingOutbound = true;
    });
  }

  setDebugInvincible(enabled: boolean): Promise<DebugSetInvincibleResponse> {
    if (!this.connected) {
      return Promise.reject(new Error('Client is not connected.'));
    }

    return new Promise((resolve) => {
      this.client.network.request(RequestEndpoint.DebugSetInvincible, { enabled }, (response: DebugSetInvincibleResponse) => {
        resolve(response);
      });
      this.hasPendingOutbound = true;
    });
  }

  getLocalPresentationPosition(input: InputState, nowMs: number): { x: number; y: number } | null {
    void input;
    return this.movementPrediction.getPresentationPosition(nowMs);
  }

  queueCommand(command: InputCommandPayload): boolean {
    if (!this.connected) {
      return false;
    }

    const predictionTick = this.client.network.clientTick;
    const networkCommand = quantizeInputCommandForNetwork({
      ...command,
      clientTick: predictionTick,
    });
    this.client.addCommand(networkCommand);
    this.recordReplayCommand(predictionTick, networkCommand);
    this.movementPrediction.applyLocalCommand(networkCommand);
    this.recordLocalPrediction(predictionTick);
    this.diagnostics.recordCommandQueued(networkCommand.sequence, predictionTick, this.countReplayHistoryCommands());
    this.hasPendingOutbound = true;
    return true;
  }

  flushOutbound(): void {
    if (!this.connected || !this.hasOutboundWork()) {
      return;
    }

    this.client.flush();
    this.hasPendingOutbound = false;
  }

  pump(): void {
    let messageCount = 0;
    while (this.client.network.messages.length > 0) {
      const message = this.client.network.messages.shift();
      messageCount += 1;
      if (message?.ntype === NType.IdentityMessage) {
        const changedIdentity = this.state.localEntityId !== message.entityId;
        this.state.setLocalEntityId(message.entityId);
        if (changedIdentity) {
          this.handleAuthoritativeReset();
        }
      }
      if (message?.ntype === NType.WorldInitMessage) {
        this.state.applyWorldInit(message);
        this.handleAuthoritativeReset();
      }
      if (message?.ntype === NType.TileMutationMessage) {
        this.state.applyTileMutation(message);
        this.handleAuthoritativeReset();
      }
      if (message?.ntype === NType.MapTransferMessage) {
        this.beginMapTransfer(message);
        return;
      }
    }
    this.diagnostics.recordMessages(messageCount);
    this.recordReceivedServerFrames();
    this.processPredictionErrorFrames();
    this.recordNengiConfirmation();

    for (const frame of this.interpolator.getInterpolatedState(NET_TIMING.interpolationDelayMs)) {
      this.diagnostics.recordEntityCreates(frame.createEntities.length);
      this.diagnostics.recordEntityUpdates(frame.updateEntities.length);
      this.diagnostics.recordEntityDeletes(frame.deleteEntities.length);
      for (const entity of frame.createEntities) {
        this.state.upsertEntity(entity as ClientEntity);
        if ((entity as ClientEntity).entityId === this.state.localEntityId) {
          this.handleAuthoritativeReset();
        }
      }
      for (const update of frame.updateEntities) {
        const entity = this.state.entities.get(update.nid);
        if (!entity) {
          continue;
        }

        if (this.movementPrediction.shouldApplyServerUpdate(entity, update.prop)) {
          this.state.patchEntity(update.nid, update.prop, update.value);
          continue;
        }
      }
      for (const nid of frame.deleteEntities) {
        if (this.state.entities.get(nid)?.entityId === this.state.localEntityId) {
          this.handleAuthoritativeReset();
        }
        this.state.deleteEntity(nid);
      }
    }
  }

  private recordReceivedServerFrames(): void {
    let receivedFrames = 0;
    for (const frame of this.client.network.frames) {
      if (frame.tick > this.latestObservedServerFrameTick) {
        this.latestObservedServerFrameTick = frame.tick;
        receivedFrames += 1;
      }
    }
    this.diagnostics.recordServerFrames(receivedFrames);
  }

  private handleAuthoritativeReset(): void {
    this.movementPrediction.handleAuthoritativeReset();
    this.client.predictor.predictionFrames.clear();
    this.client.network.outbound.unconfirmedCommands.clear();
    this.replayHistory.clear();
  }

  private beginMapTransfer(payload: MapTransferPayload): void {
    if (this.transferring) {
      return;
    }

    this.transferring = true;
    this.connected = false;
    this.hasPendingOutbound = false;
    this.diagnostics.setConnected(false);
    this.options.onMapTransferStarted?.(payload);
    this.closeCurrentSocket();
    this.state.resetForMapTransfer();
    this.resetNengiClient();
    void this.connect(payload.targetUrl, payload.token).finally(() => {
      this.transferring = false;
    });
  }

  private closeCurrentSocket(): void {
    const adapter = this.client.adapter as { socket?: WebSocket | null };
    if (adapter.socket && adapter.socket.readyState === WebSocket.OPEN) {
      adapter.socket.close(1000, 'map transfer');
    }
  }

  private resetNengiClient(): void {
    const client = createClient();
    this.client = client;
    this.interpolator = new Interpolator(client);
    this.replayHistory.clear();
    this.latestObservedServerFrameTick = 0;
    this.latestRecordedConfirmedClientTick = -1;
    this.movementPrediction.handleAuthoritativeReset();
  }

  private hasOutboundWork(): boolean {
    return (
      this.hasPendingOutbound
      || this.client.network.requestQueue.length > 0
      || this.client.network.outbound.outboundCommands.size > 0
      || this.client.network.outbound.outboundEngineCommands.size > 0
    );
  }

  private recordNengiConfirmation(): void {
    const confirmedTick = this.client.network.outbound.confirmedTick;
    if (confirmedTick <= this.latestRecordedConfirmedClientTick) {
      return;
    }

    this.latestRecordedConfirmedClientTick = confirmedTick;
    this.pruneReplayHistory(confirmedTick);
    this.diagnostics.recordNengiConfirmation(confirmedTick, this.countReplayHistoryCommands());
  }

  private processPredictionErrorFrames(): void {
    let predictionErrorFrames = 0;
    let replayedPredictionFrames = 0;

    while (this.client.network.predictionErrorFrames.length > 0) {
      const frame = this.client.network.predictionErrorFrames.shift() as PredictionErrorFrameLike | undefined;
      if (!frame) {
        continue;
      }

      predictionErrorFrames += 1;
      const replays = this.movementPrediction.reconcileFromPredictionErrorFrame(frame, this.getUnconfirmedMovementCommandSets(frame.tick));
      for (const replay of replays) {
        this.recordLocalPrediction(replay.tick, replay.entity);
        replayedPredictionFrames += 1;
      }
    }

    if (predictionErrorFrames > 0 || replayedPredictionFrames > 0) {
      this.diagnostics.recordPredictionReconciliation(predictionErrorFrames, replayedPredictionFrames);
    }
  }

  private recordLocalPrediction(tick: number, entity = this.movementPrediction.getLocalPredictionEntity()): void {
    if (!entity || !this.netEntitySchema) {
      return;
    }

    this.client.predictor.addCustom(tick, entity, PREDICTED_LOCAL_PROPS, this.netEntitySchema);
  }

  private recordReplayCommand(tick: number, command: InputCommandPayload): void {
    const existing = this.replayHistory.get(tick);
    if (existing) {
      existing.push({ ...command });
      return;
    }

    this.replayHistory.set(tick, [{ ...command }]);
  }

  private getUnconfirmedMovementCommandSets(confirmedTick: number): NengiReplayCommandSet[] {
    const commandSets: NengiReplayCommandSet[] = [];

    for (const [tick, commands] of this.replayHistory) {
      if (tick <= confirmedTick) {
        continue;
      }

      const inputCommands = commands.filter(isInputCommandPayload);
      if (inputCommands.length === 0) {
        continue;
      }

      commandSets.push({
        tick,
        commands: inputCommands,
      });
    }

    return commandSets.sort((a, b) => a.tick - b.tick);
  }

  private pruneReplayHistory(confirmedTick: number): void {
    for (const tick of this.replayHistory.keys()) {
      if (tick <= confirmedTick) {
        this.replayHistory.delete(tick);
      }
    }
  }

  private countReplayHistoryCommands(): number {
    let count = 0;
    for (const commands of this.replayHistory.values()) {
      count += commands.length;
    }
    return count;
  }
}

function isInputCommandPayload(command: unknown): command is InputCommandPayload {
  return Boolean(command && typeof command === 'object' && (command as Partial<InputCommandPayload>).ntype === NType.InputCommand);
}

function createClient(): Client {
  return new Client(ncontext, WebSocketClientAdapter, NET_TIMING.serverTickRate);
}
