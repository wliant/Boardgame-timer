// Thin REST client. All endpoints return `{ data: T }`.

import type { AppSettings, Device, GameConfig, GameState, Id } from "@/shared/types";

export type ApiError = {
  error: { code: string; message: string; details?: unknown };
};

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = json as ApiError;
    throw new Error(
      `${err.error?.code ?? "http-" + String(res.status)}: ${err.error?.message ?? res.statusText}`,
    );
  }
  return (json as { data: T }).data;
}

export const api = {
  // session
  getState: () => call<GameState>("GET", "/api/session/state"),
  startConfig: () => call<GameState>("POST", "/api/session/start-config"),
  putConfig: (config: GameConfig) =>
    call<GameState>("PUT", "/api/session/config", { data: config }),
  confirmConfig: () => call<GameState>("POST", "/api/session/confirm-config"),
  startGame: () => call<GameState>("POST", "/api/session/start-game"),
  endTurn: () => call<GameState>("POST", "/api/session/end-turn"),
  confirmNextRound: (playerIds: Id[]) =>
    call<GameState>("POST", "/api/session/confirm-next-round", { data: { playerIds } }),
  pause: () => call<GameState>("POST", "/api/session/pause"),
  resume: () => call<GameState>("POST", "/api/session/resume"),
  undo: () => call<GameState>("POST", "/api/session/undo"),
  adjustTime: (playerId: Id, deltaMs: number) =>
    call<GameState>("POST", "/api/session/adjust-time", {
      data: { playerId, deltaMs },
    }),
  dismissAlert: (playerId: Id) =>
    call<GameState>("POST", "/api/session/dismiss-alert", {
      data: { playerId },
    }),
  restart: () => call<GameState>("POST", "/api/session/restart"),
  endGame: () => call<GameState>("POST", "/api/session/end-game"),
  // settings
  getSettings: () => call<AppSettings>("GET", "/api/settings"),
  putSettings: (settings: AppSettings) =>
    call<AppSettings>("PUT", "/api/settings", { data: settings }),
  listDevices: () => call<Device[]>("GET", "/api/settings/devices"),
  addDevice: (device: Omit<Device, "id">) =>
    call<Device>("POST", "/api/settings/devices", device),
  patchDevice: (
    id: Id,
    patch: Partial<{ name: string; topic: string; acceptedActions: string[] | null }>,
  ) => call<Device>("PATCH", `/api/settings/devices/${id}`, patch),
  deleteDevice: (id: Id) =>
    call<void>("DELETE", `/api/settings/devices/${id}`),
  // mqtt discover
  startDiscovery: (windowMs?: number) =>
    call<{ windowMs: number; endsAt: number }>(
      "POST",
      "/api/settings/mqtt-discover",
      windowMs !== undefined ? { windowMs } : undefined,
    ),
  getDiscovery: () =>
    call<{ topic: string; samplePayload: string; count: number; firstSeenAt: number }[]>(
      "GET",
      "/api/settings/mqtt-discover",
    ),
  stopDiscovery: () => call<void>("DELETE", "/api/settings/mqtt-discover"),
};
