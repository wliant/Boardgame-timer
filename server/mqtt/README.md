# server/mqtt

Singleton `mqtt.js` v5 client. Subscribes to configured device topics, runs
incoming payloads through the qualification + debounce pipeline, and emits
`EndTurn` events into the reducer.

See [`specs/07-mqtt-integration.md`](../../specs/07-mqtt-integration.md) for
the authoritative topic schema, payload qualification rules, and debounce
window.
