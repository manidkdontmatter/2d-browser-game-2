// Renders tile chunks, replicated entities, local presentation state, and reticle with Pixi.
import { Application, Container, Graphics, Texture } from 'pixi.js';
import { CompositeTilemap } from '@pixi/tilemap';
import { MELEE_RANGE, TILE_SIZE } from '../../shared/config.js';
import { NetEntityKind } from '../../shared/domain/snapshots.js';
import { coordKey } from '../../shared/math/vector.js';
import { TileType } from '../../shared/world/mapTypes.js';
import { getTileDefinition, renderableTileTypes } from '../../shared/world/tileDefinitions.js';
import { AssetLoader } from '../assets/index.js';
import { CLIENT_TILE_CHUNK_SIZE, ClientEntity, ClientWorldState } from '../game/clientWorldState.js';

export interface LocalPresentationPosition {
  x: number;
  y: number;
}

interface MeleeDiagnosticEffect {
  originX: number;
  originY: number;
  aimX: number;
  aimY: number;
  startedAtMs: number;
}

interface EntityView {
  graphics: Graphics;
  kind: NetEntityKind;
  isLocal: boolean;
  facing: number;
}

interface TileChunkView {
  tilemap: CompositeTilemap;
  revision: string;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.001;
const DEFAULT_ZOOM = 1.0;

const TILE_CHUNK_SIZE = CLIENT_TILE_CHUNK_SIZE;
const TILE_CHUNK_WORLD_SIZE = TILE_CHUNK_SIZE * TILE_SIZE;
const TILE_CHUNK_MARGIN = 1;
const TILE_TEXTURE_INDEX: Readonly<Partial<Record<TileType, number>>> = {
  [TileType.Grass]: 0,
  [TileType.Dirt]: 1,
  [TileType.Water]: 2,
  [TileType.Wall]: 3,
};

export class GameRenderer {
  readonly app = new Application();
  private readonly world = new Container();
  private readonly tileLayer = new Container();
  private readonly meleeDiagnosticGraphics = new Graphics();
  private readonly entityLayer = new Container();
  private readonly meleeDiagnosticEffects: MeleeDiagnosticEffect[] = [];
  private readonly entityViews = new Map<number, EntityView>();
  private readonly tileChunks = new Map<string, TileChunkView>();
  private readonly tileTextures = new Map<TileType, Texture>();
  private readonly assets = new AssetLoader();
  private zoom = DEFAULT_ZOOM;

  constructor(private readonly state: ClientWorldState) {}

  getCameraZoom(): number {
    return this.zoom;
  }

  async mount(root: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: window,
      background: '#111713',
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      roundPixels: false,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    root.appendChild(this.app.canvas);
    this.app.canvas.addEventListener('wheel', (event) => this.handleWheel(event));
    await this.assets.preloadGroup('boot');
    this.primeTileTexturesFromCache();
    this.world.addChild(this.tileLayer);
    this.world.addChild(this.meleeDiagnosticGraphics);
    this.world.addChild(this.entityLayer);
    this.app.stage.addChild(this.world);
  }

  showMeleeDiagnostic(aimX: number, aimY: number, nowMs: number): void {
    const local = this.state.getLocalEntity();
    if (!local) {
      return;
    }

    this.meleeDiagnosticEffects.push({
      originX: local.x,
      originY: local.y,
      aimX,
      aimY,
      startedAtMs: nowMs,
    });
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.world.x) / this.zoom,
      y: (screenY - this.world.y) / this.zoom,
    };
  }

  render(localPresentation: LocalPresentationPosition | null, nowMs: number): void {
    this.world.scale.set(this.zoom);
    this.centerCamera(localPresentation);
    this.syncVisibleTileChunks();
    this.drawMeleeDiagnostics(nowMs);
    this.syncEntities(localPresentation);
  }

  renderGameToText(): string {
    const local = this.state.getLocalEntity();
    const payload = {
      coordinates: 'world pixels, origin top-left, x right, y down',
      localEntityId: this.state.localEntityId,
      worldSeed: this.state.identity?.seed ?? null,
      mapId: this.state.mapId || null,
      mapName: this.state.mapName || null,
      mapReady: this.state.tileMap !== null,
      player: local ? compactEntity(local) : null,
      entityCount: this.state.entities.size,
      visibleEntities: Array.from(this.state.entities.values()).slice(0, 20).map(compactEntity),
      activeTileChunks: this.tileChunks.size,
      entityViews: this.entityViews.size,
      zoom: this.zoom,
    };
    return JSON.stringify(payload);
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * (1 - event.deltaY * ZOOM_STEP)));
    if (newZoom === this.zoom) {
      return;
    }

    // Zoom toward the mouse cursor — keep the world point under the cursor stationary.
    const mouseX = event.clientX;
    const mouseY = event.clientY;
    const worldX = (mouseX - this.world.x) / this.zoom;
    const worldY = (mouseY - this.world.y) / this.zoom;
    this.zoom = newZoom;
    this.world.x = mouseX - worldX * this.zoom;
    this.world.y = mouseY - worldY * this.zoom;
  }

  private syncVisibleTileChunks(): void {
    const map = this.state.tileMap;
    if (!map || this.tileTextures.size === 0) {
      this.clearTileChunks();
      return;
    }

    const invZoom = 1 / this.zoom;
    const minWorldX = -this.world.x * invZoom;
    const minWorldY = -this.world.y * invZoom;
    const maxWorldX = (this.app.screen.width - this.world.x) * invZoom;
    const maxWorldY = (this.app.screen.height - this.world.y) * invZoom;
    const minChunkX = Math.max(0, Math.floor(minWorldX / TILE_CHUNK_WORLD_SIZE) - TILE_CHUNK_MARGIN);
    const minChunkY = Math.max(0, Math.floor(minWorldY / TILE_CHUNK_WORLD_SIZE) - TILE_CHUNK_MARGIN);
    const maxChunkX = Math.min(Math.ceil(map.width / TILE_CHUNK_SIZE) - 1, Math.floor(maxWorldX / TILE_CHUNK_WORLD_SIZE) + TILE_CHUNK_MARGIN);
    const maxChunkY = Math.min(Math.ceil(map.height / TILE_CHUNK_SIZE) - 1, Math.floor(maxWorldY / TILE_CHUNK_WORLD_SIZE) + TILE_CHUNK_MARGIN);
    const visibleKeys = new Set<string>();

    for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY += 1) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
        const key = coordKey(chunkX, chunkY);
        visibleKeys.add(key);
        const existing = this.tileChunks.get(key);
        const revision = this.state.getTileChunkRevision(chunkX, chunkY);
        if (existing?.revision === revision) {
          continue;
        }

        if (existing) {
          this.tileLayer.removeChild(existing.tilemap);
          existing.tilemap.destroy({ children: true });
        }

        const tilemap = this.buildTileChunk(chunkX, chunkY);
        this.tileChunks.set(key, { tilemap, revision });
        this.tileLayer.addChild(tilemap);
      }
    }

    for (const [key, chunk] of this.tileChunks) {
      if (visibleKeys.has(key)) {
        continue;
      }
      this.tileLayer.removeChild(chunk.tilemap);
      chunk.tilemap.destroy({ children: true });
      this.tileChunks.delete(key);
    }
  }

  private buildTileChunk(chunkX: number, chunkY: number): CompositeTilemap {
    const map = this.state.tileMap;
    const textures = renderableTileTypes.map((tile) => this.tileTextures.get(tile)).filter((texture): texture is Texture => Boolean(texture));
    if (!map || textures.length === 0) {
      return new CompositeTilemap();
    }

    const tilemap = new CompositeTilemap(textures.map((texture) => texture.source));
    const startX = chunkX * TILE_CHUNK_SIZE;
    const startY = chunkY * TILE_CHUNK_SIZE;
    const endX = Math.min(startX + TILE_CHUNK_SIZE, map.width);
    const endY = Math.min(startY + TILE_CHUNK_SIZE, map.height);

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const textureIndex = textureIndexForTile(map.getTile(x, y));
        tilemap.tile(textureIndex, x * TILE_SIZE, y * TILE_SIZE, { tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
      }
    }

    return tilemap;
  }

  private primeTileTexturesFromCache(): void {
    this.tileTextures.clear();
    for (const tile of renderableTileTypes) {
      const definition = getTileDefinition(tile);
      const texture = this.assets.getTexture(definition.assetKey);
      if (!texture) {
        throw new Error(`Missing preloaded texture for asset key ${definition.assetKey}`);
      }
      this.tileTextures.set(tile, texture);
    }
  }

  private clearTileChunks(): void {
    for (const chunk of this.tileChunks.values()) {
      this.tileLayer.removeChild(chunk.tilemap);
      chunk.tilemap.destroy({ children: true });
    }
    this.tileChunks.clear();
  }

  private centerCamera(localPresentation: LocalPresentationPosition | null): void {
    const local = this.state.getLocalEntity();
    if (!local) {
      return;
    }

    const position = localPresentation ?? local;
    this.world.x = this.app.screen.width / 2 - position.x * this.zoom;
    this.world.y = this.app.screen.height / 2 - position.y * this.zoom;
  }

  private syncEntities(localPresentation: LocalPresentationPosition | null): void {
    const liveNids = new Set<number>();

    for (const entity of this.state.entities.values()) {
      liveNids.add(entity.nid);
      const view = this.ensureEntityView(entity);
      const position = this.getRenderPosition(entity, localPresentation);
      view.graphics.x = position.x;
      view.graphics.y = position.y;
    }

    for (const [nid, view] of this.entityViews) {
      if (liveNids.has(nid)) {
        continue;
      }

      this.entityLayer.removeChild(view.graphics);
      view.graphics.destroy();
      this.entityViews.delete(nid);
    }
  }

  private ensureEntityView(entity: ClientEntity): EntityView {
    const isLocal = entity.entityId === this.state.localEntityId;
    const existing = this.entityViews.get(entity.nid);
    if (existing && existing.kind === entity.kind && existing.isLocal === isLocal) {
      if (existing.facing !== entity.facing) {
        this.drawEntityShape(existing.graphics, entity.kind, isLocal, entity.facing);
        existing.facing = entity.facing;
      }
      return existing;
    }

    if (existing) {
      this.entityLayer.removeChild(existing.graphics);
      existing.graphics.destroy();
    }

    const graphics = new Graphics();
    this.drawEntityShape(graphics, entity.kind, isLocal, entity.facing);
    this.entityLayer.addChild(graphics);
    const view = { graphics, kind: entity.kind, isLocal, facing: entity.facing };
    this.entityViews.set(entity.nid, view);
    return view;
  }

  private drawEntityShape(graphics: Graphics, kind: NetEntityKind, isLocal: boolean, facing: number): void {
    graphics.clear();
    if (kind === NetEntityKind.Projectile) {
      graphics.circle(0, 0, 10);
      graphics.fill('#f3d36b');
      return;
    }

    if (kind === NetEntityKind.Portal) {
      graphics.circle(0, 0, 52);
      graphics.fill({ color: '#f28c28', alpha: 0.65 });
      graphics.circle(0, 0, 34);
      graphics.stroke({ color: '#ffb15c', width: 5, alpha: 0.95 });
      return;
    }

    if (kind === NetEntityKind.Pickup) {
      graphics.rect(-10, -10, 20, 20);
      graphics.fill({ color: '#e3cf5b', alpha: 0.85 });
      graphics.rect(-10, -10, 20, 20);
      graphics.stroke({ color: '#f0e68c', width: 1.5, alpha: 0.9 });
      return;
    }

    graphics.ellipse(0, 0, 34, 42);
    graphics.fill(isLocal ? '#7aa2f7' : '#d44d5c');
    graphics.circle(facing >= 0 ? 11 : -11, -7, 5);
    graphics.fill('#121212');
  }

  private getRenderPosition(entity: ClientEntity, localPresentation: LocalPresentationPosition | null): { x: number; y: number } {
    if (entity.entityId === this.state.localEntityId && localPresentation) {
      return localPresentation;
    }

    return entity;
  }

  private drawMeleeDiagnostics(nowMs: number): void {
    const lifetimeMs = 220;
    this.meleeDiagnosticGraphics.clear();

    for (let i = this.meleeDiagnosticEffects.length - 1; i >= 0; i -= 1) {
      if (nowMs - this.meleeDiagnosticEffects[i].startedAtMs > lifetimeMs) {
        this.meleeDiagnosticEffects.splice(i, 1);
      }
    }

    for (const effect of this.meleeDiagnosticEffects) {
      const age = (nowMs - effect.startedAtMs) / lifetimeMs;
      const alpha = Math.max(0, 1 - age);
      const direction = Math.atan2(effect.aimY - effect.originY, effect.aimX - effect.originX);
      const halfAngle = Math.acos(0.25);
      const points = [effect.originX, effect.originY];
      const segments = 18;
      for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        const angle = direction - halfAngle + halfAngle * 2 * t;
        points.push(effect.originX + Math.cos(angle) * MELEE_RANGE, effect.originY + Math.sin(angle) * MELEE_RANGE);
      }

      this.meleeDiagnosticGraphics.poly(points);
      this.meleeDiagnosticGraphics.fill({ color: '#f6d365', alpha: 0.18 * alpha });
      this.meleeDiagnosticGraphics.stroke({ color: '#ffe08a', width: 3, alpha: 0.75 * alpha });
      this.meleeDiagnosticGraphics.circle(effect.originX, effect.originY, MELEE_RANGE);
      this.meleeDiagnosticGraphics.stroke({ color: '#ffe08a', width: 1, alpha: 0.35 * alpha });
    }
  }

}

function textureIndexForTile(tile: TileType): number {
  return TILE_TEXTURE_INDEX[tile] ?? TILE_TEXTURE_INDEX[TileType.Wall] ?? 3;
}

function compactEntity(entity: ClientEntity): Record<string, number> {
  return {
    entityId: entity.entityId,
    kind: entity.kind,
    x: Math.round(entity.x),
    y: Math.round(entity.y),
    health: entity.health,
  };
}
