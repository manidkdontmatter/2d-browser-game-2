// Tracks DOM input state and samples it into explicit shared net command payloads.
import { AttackIntent, PlayerCommand } from '../shared/domain/commands.js';
import { NType } from '../shared/net/nType.js';
import { NET_TIMING } from '../shared/net/timing.js';

export const enum ClientInputMode {
  Gameplay = 'gameplay',
  Ui = 'ui',
}

export interface InputState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  mouseX: number;
  mouseY: number;
  attack: AttackIntent;
}

export interface InputCommandPayload extends PlayerCommand {
  ntype: NType.InputCommand;
}

export class InputController {
  readonly state: InputState = {
    w: false,
    a: false,
    s: false,
    d: false,
    mouseX: 0,
    mouseY: 0,
    attack: AttackIntent.None,
  };
  private mode = ClientInputMode.Gameplay;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (event) => this.onKey(event.code, true));
    window.addEventListener('keyup', (event) => this.onKey(event.code, false));
    element.addEventListener('mousemove', (event) => {
      this.state.mouseX = event.clientX;
      this.state.mouseY = event.clientY;
    });
    element.addEventListener('contextmenu', (event) => event.preventDefault());
    element.addEventListener('mousedown', (event) => {
      if (this.mode !== ClientInputMode.Gameplay) {
        return;
      }
      this.state.attack = event.button === 2 ? AttackIntent.Projectile : AttackIntent.Melee;
    });
  }

  getMode(): ClientInputMode {
    return this.mode;
  }

  setMode(mode: ClientInputMode): void {
    if (this.mode === mode) {
      return;
    }

    this.mode = mode;
    this.clearGameplayIntent();
  }

  consumeAttack(): AttackIntent {
    const attack = this.state.attack;
    this.state.attack = AttackIntent.None;
    return attack;
  }

  private onKey(code: string, pressed: boolean): void {
    if (this.mode !== ClientInputMode.Gameplay) {
      return;
    }
    this.setKey(code, pressed);
  }

  private setKey(code: string, pressed: boolean): void {
    if (code === 'KeyW') this.state.w = pressed;
    if (code === 'KeyA') this.state.a = pressed;
    if (code === 'KeyS') this.state.s = pressed;
    if (code === 'KeyD') this.state.d = pressed;
  }

  private clearGameplayIntent(): void {
    this.state.w = false;
    this.state.a = false;
    this.state.s = false;
    this.state.d = false;
    this.state.attack = AttackIntent.None;
  }
}

export class InputCommandSampler {
  private nextSequence = 1;
  private lastSent: InputCommandPayload | null = null;
  private lastSentAtMs = Number.NEGATIVE_INFINITY;

  sample(state: InputState, aimWorldX: number, aimWorldY: number, attack: AttackIntent, nowMs: number): InputCommandPayload {
    const axis = movementAxis(state);
    const command: InputCommandPayload = {
      ntype: NType.InputCommand,
      moveX: axis.x,
      moveY: axis.y,
      aimX: aimWorldX,
      aimY: aimWorldY,
      attack,
      sequence: this.nextSequence,
      clientTick: 0,
      clientTimeMs: nowMs,
    };
    return command;
  }

  shouldSend(command: InputCommandPayload, nowMs: number): boolean {
    if (command.attack !== AttackIntent.None) {
      return true;
    }

    if (command.moveX !== 0 || command.moveY !== 0) {
      return true;
    }

    if (this.lastSent === null) {
      return true;
    }

    if (!commandsAreRedundant(this.lastSent, command)) {
      return true;
    }

    return nowMs - this.lastSentAtMs >= NET_TIMING.inputHeartbeatMs;
  }

  markSent(command: InputCommandPayload, nowMs: number): void {
    this.lastSent = command;
    this.lastSentAtMs = nowMs;
    if (command.sequence === this.nextSequence) {
      this.nextSequence += 1;
    }
  }

  reset(): void {
    this.nextSequence = 1;
    this.lastSent = null;
    this.lastSentAtMs = Number.NEGATIVE_INFINITY;
  }
}

function movementAxis(state: InputState): { x: number; y: number } {
  const x = (state.d ? 1 : 0) - (state.a ? 1 : 0);
  const y = (state.s ? 1 : 0) - (state.w ? 1 : 0);
  const length = Math.hypot(x, y);
  if (length === 0) {
    return { x: 0, y: 0 };
  }
  return { x: x / length, y: y / length };
}

function commandsAreRedundant(previous: InputCommandPayload, next: InputCommandPayload): boolean {
  const aimIsRelevant = previous.attack !== AttackIntent.None || next.attack !== AttackIntent.None;
  return (
    previous.moveX === next.moveX &&
    previous.moveY === next.moveY &&
    (!aimIsRelevant || (previous.aimX === next.aimX && previous.aimY === next.aimY)) &&
    previous.attack === next.attack
  );
}
