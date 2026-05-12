# server/sse

SSE channel that fans out reducer-emitted events to all connected host tabs.
The full event catalog lives in
[`specs/06-server-api.md`](../../specs/06-server-api.md). Event payload sketches
are typed in [`shared/events.ts`](../../shared/events.ts).
