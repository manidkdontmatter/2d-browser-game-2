// Registers nengi schemas for the authoritative client/server network protocol.
import { Binary, Context, defineSchema } from 'nengi';
import { NType } from './nType.js';

export const ncontext = new Context();

ncontext.register(
  NType.InputCommand,
  defineSchema({
    moveX: Binary.Float32,
    moveY: Binary.Float32,
    aimX: Binary.Float32,
    aimY: Binary.Float32,
    attack: Binary.UInt8,
    sequence: Binary.UInt32,
    clientTick: Binary.UInt32,
    clientTimeMs: Binary.Float64,
  }),
);

ncontext.register(
  NType.NetEntity,
  defineSchema({
    entityId: Binary.UInt32,
    kind: Binary.UInt8,
    x: { type: Binary.Float32, interp: true },
    y: { type: Binary.Float32, interp: true },
    health: Binary.Int16,
    facing: Binary.Int8,
  }),
);

ncontext.register(
  NType.IdentityMessage,
  defineSchema({
    entityId: Binary.UInt32,
  }),
);

ncontext.register(
  NType.WorldInitMessage,
  defineSchema({
    mapId: Binary.String,
    mapName: Binary.String,
    seed: Binary.String,
    generatorVersion: Binary.UInt16,
    width: Binary.UInt16,
    height: Binary.UInt16,
    settingsJson: Binary.String,
  }),
);

ncontext.register(
  NType.MapTransferMessage,
  defineSchema({
    targetMapId: Binary.String,
    targetMapName: Binary.String,
    targetUrl: Binary.String,
    token: Binary.String,
  }),
);

ncontext.register(
  NType.TileMutationMessage,
  defineSchema({
    x: Binary.UInt16,
    y: Binary.UInt16,
    tile: Binary.UInt8,
  }),
);
