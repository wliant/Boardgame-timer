// Helpers for integration tests. Provides:
//   - per-test SQLite path setup/cleanup
//   - readSSE: collect a fixed set of SSE event names from an open Response
//   - waitFor: poll a predicate until true or timeout

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SseEvent, SseEventName } from "@/shared/events";

export function withTempDb(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "bgt-it-"));
  const path = join(dir, "settings.db");
  process.env["BGT_DB_PATH"] = path;
  return {
    path,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export type CollectedEvent = { event: SseEventName; data: unknown };

export function collectSseEvents(
  response: Response,
  filter?: SseEventName[],
): { events: CollectedEvent[]; stop: () => void } {
  const events: CollectedEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let stopped = false;
  void (async () => {
    while (!stopped) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (chunk.startsWith(":")) continue; // comment (keepalive)
        const ev = parseSseChunk(chunk);
        if (!ev) continue;
        if (filter && !filter.includes(ev.event)) continue;
        events.push(ev);
      }
    }
  })().catch(() => {
    /* reader cancelled */
  });
  return {
    events,
    stop: () => {
      stopped = true;
      reader.cancel().catch(() => {});
    },
  };
}

function parseSseChunk(chunk: string): CollectedEvent | null {
  const lines = chunk.split("\n");
  let event: string | null = null;
  let data: string | null = null;
  for (const line of lines) {
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("data: ")) data = line.slice(6).trim();
  }
  if (!event || data === null) return null;
  try {
    return { event: event as SseEventName, data: JSON.parse(data) as unknown };
  } catch {
    return null;
  }
}

export function sseEventNames(events: CollectedEvent[]): SseEventName[] {
  return events.map((e) => e.event);
}

/**
 * Wait for one or more SSE events of the given names to arrive in the collector.
 * Returns the first matching event.
 */
export async function expectSseEvent(
  collector: { events: CollectedEvent[] },
  name: SseEvent["event"],
  timeoutMs = 2_000,
): Promise<CollectedEvent> {
  await waitFor(() => collector.events.some((e) => e.event === name), timeoutMs);
  return collector.events.find((e) => e.event === name)!;
}
