// In-process SSE fan-out channel. Subscribers are ReadableStream controllers;
// each receives every emitted event. The `state` snapshot is sent on subscribe.

import type { SseEvent } from "@/shared/events";
import type { GameState } from "@/shared/types";

type Subscriber = {
  send: (event: SseEvent) => void;
  close: () => void;
};

const KEEPALIVE_INTERVAL_MS = 15_000;

export class SseChannel {
  private readonly subscribers = new Set<Subscriber>();
  private getState: () => GameState = () => {
    throw new Error("SseChannel: getState not wired");
  };

  setStateProvider(provider: () => GameState): void {
    this.getState = provider;
  }

  emit(event: SseEvent): void {
    for (const sub of this.subscribers) {
      try {
        sub.send(event);
      } catch {
        // Best-effort; closed subscribers are pruned on close().
      }
    }
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Open an SSE response for a Web-API ReadableStream consumer. */
  openResponse(req: Request): Response {
    const encoder = new TextEncoder();
    const channel = this;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const safeEnqueue = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };

        const subscriber: Subscriber = {
          send(event) {
            const payload = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
            safeEnqueue(payload);
          },
          close() {
            closed = true;
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          },
        };
        channel.subscribers.add(subscriber);

        // Initial snapshot.
        subscriber.send({ event: "state", data: channel.getState() });

        const keepalive = setInterval(() => {
          safeEnqueue(`: keepalive ${Date.now()}\n\n`);
        }, KEEPALIVE_INTERVAL_MS);

        const onAbort = () => {
          clearInterval(keepalive);
          channel.subscribers.delete(subscriber);
          subscriber.close();
        };
        req.signal.addEventListener("abort", onAbort, { once: true });
      },
      cancel() {
        // controller cancel — subscriber removal handled by abort listener.
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }
}
