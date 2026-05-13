// Tracks DOM input state and samples it into explicit shared net command payloads.
import { AttackIntent, NO_HOTBAR_SLOT, PlayerCommand } from '../shared/domain/commands.js';
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
  e: boolean;
  mouseX: number;
  mouseY: number;
  attack: AttackIntent;
  hotbarSlotActivated: number;
}

export interface InputCommandPayload extends PlayerCommand {
  ntype: NType.InputCommand;
}

const HOTBAR_KEY_CODES: Readonly<Record<string, number>> = {
  Digit0: 2,
  Digit1: 3,
  Digit2: 4,
  Digit3: 5,
  Digit4: 6,
  Digit5: 7,
  Digit6: 8,
  Digit7: 9,
  Digit8: 10,
  Digit9: 11,
};

export class InputController {
  readonly state: InputState = {
    w: false,
    a: false,
    s: false,
    d: false,
    e: false,
    mouseX: 0,
    mouseY: 0,
    attack: AttackIntent.None,
    hotbarSlotActivated: NO_HOTBAR_SLOT,
  };
  private mode = ClientInputMode.Gameplay;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (event) => this.onKey(event.code, true));
    window.addEventListener('keyup', (event) => this.onKey(event.code, false));
    window.addEventListener('mousemove', (event) => {
      this.state.mouseX = event.clientX;
      this.state.mouseY = event.clientY;
    });
    window.addEventListener('contextmenu', (event) => event.preventDefault());
    element.addEventListener('mousedown', (event) => {
      if (this.mode !== ClientInputMode.Gameplay) {
        return;
      }
      if (event.button === 0) {
        this.state.hotbarSlotActivated = 0;
        this.state.attack = AttackIntent.Melee;
      } else if (event.button === 2) {
        this.state.hotbarSlotActivated = 1;
        this.state.attack = AttackIntent.Projectile;
      }
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

  consumeInteract(): boolean {
    const interact = this.state.e;
    this.state.e = false;
    return interact;
  }

  consumeAttack(): AttackIntent {
    const attack = this.state.attack;
    this.state.attack = AttackIntent.None;
    return attack;
  }

  consumeHotbarSlotActivated(): number {
    const slot = this.state.hotbarSlotActivated;
    this.state.hotbarSlotActivated = NO_HOTBAR_SLOT;
    return slot;
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
    if (code === 'KeyE') this.state.e = pressed;

    if (pressed) {
      const hotbarSlot = HOTBAR_KEY_CODES[code];
      if (hotbarSlot !== undefined) {
        this.state.hotbarSlotActivated = hotbarSlot;
      }
    }
  }

  private clearGameplayIntent(): void {
    this.state.w = false;
    this.state.a = false;
    this.state.s = false;
    this.state.d = false;
    this.state.e = false;
    this.state.attack = AttackIntent.None;
    this.state.hotbarSlotActivated = NO_HOTBAR_SLOT;
  }
}

export class InputCommandSampler {
  private nextSequence = 1;
  private lastSent: InputCommandPayload | null = null;
  private lastSentAtMs = Number.NEGATIVE_INFINITY;

  sample(state: InputState, aimWorldX: number, aimWorldY: number, attack: AttackIntent, interact: boolean, nowMs: number, hotbarSlotActivated: number): InputCommandPayload {
    const axis = movementAxis(state);
    const command: InputCommandPayload = {
      ntype: NType.InputCommand,
      moveX: axis.x,
      moveY: axis.y,
      aimX: aimWorldX,
      aimY: aimWorldY,
      attack,
      interact,
      sequence: this.nextSequence,
      clientTick: 0,
      clientTimeMs: nowMs,
      hotbarSlotActivated,
    };
    return command;
  }

  shouldSend(command: InputCommandPayload, nowMs: number): boolean {
    if (command.attack !== AttackIntent.None || command.interact) {
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
    previous.attack === next.attack &&
    previous.interact === next.interact
  );
}
