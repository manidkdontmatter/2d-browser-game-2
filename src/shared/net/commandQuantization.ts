// Matches client-side prediction inputs to the numeric precision that nengi transmits to the server.
import { PlayerCommand } from '../domain/commands.js';

export function quantizeInputCommandForNetwork<T extends PlayerCommand>(command: T): T {
  return {
    ...command,
    moveX: Math.fround(command.moveX),
    moveY: Math.fround(command.moveY),
    aimX: Math.fround(command.aimX),
    aimY: Math.fround(command.aimY),
  };
}
