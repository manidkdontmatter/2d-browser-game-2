// Accumulates input samples and flushes commands at the configured network rate instead of
// inlining the rate-limit logic inside the render loop.
import { AttackIntent, NO_HOTBAR_SLOT } from '../../shared/domain/commands.js';
import { CLIENT_COMMAND_PACKET_INTERVAL_MS, MOVEMENT_COMMAND_INTERVAL_MS, NET_TIMING } from '../../shared/net/timing.js';
import { ClientDiagnostics } from '../diagnostics/clientDiagnostics.js';
import { ClientInputMode, InputCommandSampler, InputState } from '../input.js';
import { ClientConnection } from './clientConnection.js';

export class CommandStream {
  private inputSampler = new InputCommandSampler();
  private inputAccumulatorMs = 0;
  private outboundAccumulatorMs = 0;

  constructor(
    private readonly connection: ClientConnection,
    private readonly diagnostics: ClientDiagnostics,
    private readonly getInputMode: () => ClientInputMode,
    private readonly consumeAttack: () => AttackIntent,
    private readonly consumeInteract: () => boolean,
    private readonly consumeHotbarSlot: () => number,
  ) {}

  reset(): void {
    this.inputSampler = new InputCommandSampler();
    this.inputAccumulatorMs = 0;
    this.outboundAccumulatorMs = 0;
  }

  update(inputState: InputState, aimX: number, aimY: number, nowMs: number, elapsedMs: number): void {
    this.outboundAccumulatorMs = Math.min(
      this.outboundAccumulatorMs + elapsedMs,
      CLIENT_COMMAND_PACKET_INTERVAL_MS,
    );

    if (this.getInputMode() !== ClientInputMode.Gameplay) {
      this.inputAccumulatorMs = 0;
      return;
    }

    this.inputAccumulatorMs = Math.min(
      this.inputAccumulatorMs + elapsedMs,
      MOVEMENT_COMMAND_INTERVAL_MS * NET_TIMING.maxClientInputCommandsPerFrame,
    );

    let commandsCreatedThisFrame = 0;
    let attackConsumedThisFrame = false;
    let interactConsumedThisFrame = false;
    let hotbarConsumedThisFrame = false;

    while (
      this.inputAccumulatorMs >= MOVEMENT_COMMAND_INTERVAL_MS
      && commandsCreatedThisFrame < NET_TIMING.maxClientInputCommandsPerFrame
    ) {
      const commandAttack = attackConsumedThisFrame ? AttackIntent.None : inputState.attack;
      const commandInteract = interactConsumedThisFrame ? false : this.consumeInteract();
      const commandHotbarSlot = hotbarConsumedThisFrame ? NO_HOTBAR_SLOT : this.consumeHotbarSlot();
      const command = this.inputSampler.sample(inputState, aimX, aimY, commandAttack, commandInteract, nowMs, commandHotbarSlot);
      this.diagnostics.recordInputSample(nowMs);

      if (this.inputSampler.shouldSend(command, nowMs) && this.connection.queueCommand(command)) {
        this.inputSampler.markSent(command, nowMs);
        if (commandAttack !== AttackIntent.None) {
          this.consumeAttack();
          attackConsumedThisFrame = true;
        }
        if (commandInteract) {
          interactConsumedThisFrame = true;
        }
        if (commandHotbarSlot !== NO_HOTBAR_SLOT) {
          hotbarConsumedThisFrame = true;
        }
      }

      this.inputAccumulatorMs -= MOVEMENT_COMMAND_INTERVAL_MS;
      commandsCreatedThisFrame += 1;
    }
  }

  flushIfNeeded(): void {
    if (this.outboundAccumulatorMs >= CLIENT_COMMAND_PACKET_INTERVAL_MS) {
      this.connection.flushOutbound();
      this.outboundAccumulatorMs = 0;
    }
  }
}
