# API route handlers

Route handlers in this directory mirror the REST + SSE surface defined in
[`specs/06-server-api.md`](../../specs/06-server-api.md). Each endpoint there
maps to a `route.ts` file under the matching path.

The only handler implemented at scaffolding time is `health/route.ts`, which
returns `{ ok: true }`. The rest are intentionally absent and will be added as
the server reducer and SSE channel come online.
