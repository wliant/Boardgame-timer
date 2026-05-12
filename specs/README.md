# Boardgame Timer — Specifications

## Purpose & audience

This folder is the authoritative specification of the Boardgame Timer web app. It is intended for the engineer (human or agent) who will implement the app, and for future contributors who need to understand the design without re-deriving it from code.

The app helps a single host facilitate a board-game session by tracking each player's clock. It runs on a single host screen connected to an external MQTT broker for optional physical-button integration.

Every behavior, contract, and data shape in the implementation MUST trace back to one of these documents. If a behavior is not specified here, it is undefined; raise a question rather than guessing.

## Document map

Read in order on first pass.

| # | File | What it covers |
| -- | ---- | -------------- |
| 00 | [README.md](./README.md) | This index and conventions. |
| 01 | [01-overview.md](./01-overview.md) | Product goals, personas, architecture, tech-stack decisions. |
| 02 | [02-session-lifecycle.md](./02-session-lifecycle.md) | **Authoritative** phase state machine and transition table. |
| 03 | [03-timer-config.md](./03-timer-config.md) | Timer-mode, end-of-turn-trigger, turn-order, player config, validation rules. |
| 04 | [04-in-game-behavior.md](./04-in-game-behavior.md) | Tick model, time-out, pause, undo, time-adjust, **control inventory**. |
| 05 | [05-data-model.md](./05-data-model.md) | **Authoritative** entity types: AppSettings, GameConfig, GameState, etc. |
| 06 | [06-server-api.md](./06-server-api.md) | REST endpoints and **authoritative** SSE event catalog. |
| 07 | [07-mqtt-integration.md](./07-mqtt-integration.md) | **Authoritative** MQTT topic/payload schema, debounce, mapping rules. |
| 08 | [08-ui-screens.md](./08-ui-screens.md) | Screen-by-screen layouts, wireframes, and interactions. |
| 09 | [09-persistence.md](./09-persistence.md) | SQLite schema, browser cache, in-memory game state. |
| 10 | [10-glossary.md](./10-glossary.md) | Definitions of session, game, round, turn, etc. |

## Single-owner concerns

When in doubt about where a concept lives, consult this table. Other documents MUST cross-link, not redefine.

| Concern | Owner file |
| --- | --- |
| Session phase state machine | `02-session-lifecycle.md` |
| All entity shapes / types | `05-data-model.md` |
| MQTT topic schema and payload matcher | `07-mqtt-integration.md` |
| SSE event catalog | `06-server-api.md` |
| In-game control button inventory | `04-in-game-behavior.md` |

## Conventions

- **RFC 2119 keywords** — `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY` carry their RFC 2119 meanings. Lowercased "must/should" are non-normative prose.
- **Durations** — all durations are integer milliseconds (`ms`) unless explicitly noted otherwise. User-facing inputs are entered in seconds and converted at the boundary.
- **Timestamps** — `epoch ms` (`Date.now()` semantics) for any wall-clock instant. `monotonic ms` (`performance.now()` semantics) for elapsed-time measurement; never mix the two.
- **Identifiers** — `id` fields are opaque strings (UUID v4 unless a section specifies otherwise).
- **Diagrams** — Mermaid syntax inside `mermaid` fenced blocks.
- **TypeScript** — type signatures are written as TypeScript and are the source of truth for shapes; JSON examples are illustrative only.
- **Error handling** — see `06-server-api.md` for the shared error envelope. Specs SHOULD enumerate error codes a section can raise rather than catch-all "returns 400".
- **Phase names** — `Lobby`, `Configuring`, `Ready`, `Running`, `Paused`, `BetweenRounds` are the only valid phase identifiers. They are defined in `02-session-lifecycle.md` and MUST be referenced verbatim elsewhere.

## Versioning

This is v1 of the spec set, targeting the v1 release of the app. Breaking changes to the contract bump the spec version in a `CHANGELOG.md` (to be added when first revision is needed).
