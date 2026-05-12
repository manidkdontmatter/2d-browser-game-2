# 2D Browser Game

A TypeScript browser game prototype for a server-authoritative, top-down multiplayer sandbox. The client runs in the browser with Pixi, while Node-hosted authoritative map runtimes own simulation, persistence, physics, and nengi networking.

The long-term target is a production-quality 2D open-world sandbox that can run player-hosted servers on ordinary VPS machines. Current gameplay is intentionally early, but the repo is organized around the final architecture: explicit client/server/shared boundaries, authoritative server state, deterministic shared world generation inputs, composable gameplay data, and area-of-interest replication.

## Stack

- TypeScript, Node.js, npm, Vite
- PixiJS for browser rendering
- nengi 2 alpha for networking
- bitecs for ECS-style data layout
- SKALE Physics for simulation collisions
- better-sqlite3 for map persistence

## Project Layout

- `src/client/` - browser client, input, Pixi rendering, UI, diagnostics, and nengi client connection
- `src/server/` - server manager, map runtimes, simulation systems, persistence, diagnostics, and nengi server integration
- `src/shared/` - shared protocol, commands, world generation, movement rules, combat data, pathfinding, and domain types
- `tests/` - focused unit and integration coverage for shared, client, and server systems
- `data/` - local runtime SQLite world data, ignored by Git
- `dist/` - production build output, ignored by Git
- `output/` - local profiler output, ignored by Git
- `docs/nginx/` - deployment examples

## Requirements

- Node.js `20.19.0` or newer
- npm

Install dependencies:

```sh
npm install
```

## Local Development

Run the Vite client and authoritative server manager together:

```sh
npm run dev
```

By default:

- Vite serves the browser client on `http://127.0.0.1:5173`
- Test Map A listens for WebSocket traffic on `ws://127.0.0.1:9001`
- Test Map B listens for WebSocket traffic on `ws://127.0.0.1:9002`
- Local map persistence is written under `data/`

The browser client connects to Map A by default in local development. Map transfers are handled by the authoritative server, which tells the client which target map WebSocket URL and token to use.

## Build

Create production client and server output:

```sh
npm run build
```

The browser bundle is emitted to `dist/client`. The server build is emitted to `dist/server`.

Run the built server manager:

```sh
node dist/server/server/main.js
```

## Production Deployment Notes

A typical single-VPS deployment should keep the map runtime ports private on localhost and expose only Nginx publicly:

- Nginx serves `dist/client`
- Nginx proxies public WebSocket paths to localhost map runtime ports
- Node runs the built server manager as a systemd service, process manager service, or similar long-running process

Set these environment variables for a public deployment:

```sh
PUBLIC_WS_BASE_URL=wss://example.com/ws
VITE_GAME_WS_URL=wss://example.com/ws/test-map-a
```

`VITE_GAME_WS_URL` is baked into the client at build time by Vite. `PUBLIC_WS_BASE_URL` is read by the server manager when it starts and is used for map-transfer URLs sent to clients.

If you build without `VITE_GAME_WS_URL`, the production client falls back to the same host that served the page and connects to `/ws/test-map-a`.

## Nginx

See [docs/nginx/2d-browser-game.example.conf](docs/nginx/2d-browser-game.example.conf) for an HTTPS Nginx server block that serves the Vite build and proxies the two current map runtimes:

- `/ws/test-map-a` -> `127.0.0.1:9001`
- `/ws/test-map-b` -> `127.0.0.1:9002`

Replace `example.com`, certificate paths, and `root` with the real deployment values.

## Useful Scripts

```sh
npm run dev
npm run build
npm run test
npm run diagnose:loop
npm run diagnose:net:aoi
npm run diagnose:net:commands
npm run diagnose:scale
```

Diagnostics may write profiler data to `output/` and runtime world data to `data/`; both are intentionally ignored by Git.
