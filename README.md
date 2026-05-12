# Boardgame Timer

A single-host web app that allocates a clock to each player in a board-game
session. Supports total-time and turn-by-turn timer disciplines, with
end-of-turn via screen tap or MQTT (Aqara-style) physical buttons.

## Status

Pre-implementation scaffolding. The normative specification lives in
[`specs/`](./specs/) — start with
[`01-overview.md`](./specs/01-overview.md).

## Quickstart

Prerequisites: Node 20.18+, [pnpm](https://pnpm.io/) 9, Docker (for the
MQTT broker).

```sh
pnpm install
cp .env.example .env.local
pnpm mqtt:up           # starts Eclipse Mosquitto on :1883
pnpm dev               # http://localhost:3000
```

Open <http://localhost:3000>, then go to **Settings** and point the app at
`mqtt://localhost:1883`.

## Scripts

- **Dev / build**: `pnpm dev`, `pnpm build`, `pnpm start`
- **Quality**: `pnpm lint`, `pnpm typecheck`, `pnpm format`
- **Tests**: `pnpm test`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`
- **MQTT**: `pnpm mqtt:up`, `pnpm mqtt:down`, `pnpm mqtt:logs`
- **Helpers**: `pnpm fake-button` (publish a synthetic press), `pnpm seed:devices` (insert demo devices)

## Documentation

The normative spec lives in [`./specs/`](./specs/). Recommended reading order:

1. [`01-overview.md`](./specs/01-overview.md) — goals, non-goals, architecture
2. [`11-testing-and-dev.md`](./specs/11-testing-and-dev.md) — dev workflow

## License

[Apache-2.0](./LICENSE).
