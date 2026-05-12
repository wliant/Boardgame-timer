// SSE hook with exponential reconnect (1, 2, 4, 5s cap). Applies events into
// a GameState replica and tracks AppSettings + transient UI state.

"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import type { DiscoveryMessage, SseEvent } from "@/shared/events";
import type { Alert, AppSettings, GameState } from "@/shared/types";

import { api } from "./api";
import { readCachedSettings, writeCachedSettings } from "./settingsCache";

const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 5_000];

export type Toast = {
  id: string;
  message: string;
  kind: "press-ignored" | "error";
};

type ReducerState = {
  game: GameState | null;
  settings: AppSettings | null;
  toasts: Toast[];
  staleSince: number | null;
  discovery: DiscoveryMessage[];
};

type ReducerAction =
  | { type: "SET_GAME"; state: GameState }
  | { type: "SET_SETTINGS"; settings: AppSettings }
  | { type: "ADD_TOAST"; toast: Toast }
  | { type: "REMOVE_TOAST"; id: string }
  | { type: "SET_STALE"; since: number | null }
  | { type: "SSE_EVENT"; event: SseEvent }
  | { type: "ADD_DISCOVERY"; msg: DiscoveryMessage }
  | { type: "CLEAR_DISCOVERY" };

function applySse(state: ReducerState, event: SseEvent): ReducerState {
  if (!state.game && event.event !== "state") return state;
  switch (event.event) {
    case "state":
      return { ...state, game: event.data };
    case "tick": {
      const g = state.game!;
      return {
        ...state,
        game: {
          ...g,
          turnStartedAt: event.data.turnStartedAt,
          remainingMs: { ...g.remainingMs, [event.data.playerId]: event.data.remainingMs },
        },
      };
    }
    case "phase-changed":
      return {
        ...state,
        game: { ...state.game!, phase: event.data.phase },
      };
    case "turn-switched": {
      const g = state.game!;
      return {
        ...state,
        game: {
          ...g,
          currentPlayerIdx: event.data.currentPlayerIdx,
          currentOrder: event.data.currentOrder,
          roundNumber: event.data.roundNumber,
          turnStartedAt: event.data.turnStartedAt,
          remainingMs: event.data.remainingMs,
        },
      };
    }
    case "alert-raised": {
      const g = state.game!;
      const alert: Alert = event.data;
      if (g.alerts.some((a) => a.playerId === alert.playerId && a.kind === alert.kind))
        return state;
      return { ...state, game: { ...g, alerts: [...g.alerts, alert] } };
    }
    case "alert-cleared": {
      const g = state.game!;
      return {
        ...state,
        game: {
          ...g,
          alerts: g.alerts.filter(
            (a) => !(a.playerId === event.data.playerId && a.kind === event.data.kind),
          ),
        },
      };
    }
    case "mqtt-status": {
      const g = state.game!;
      return {
        ...state,
        game: {
          ...g,
          mqtt: {
            ...g.mqtt,
            connected: event.data.connected,
            lastError: event.data.lastError,
          },
        },
      };
    }
    case "settings-changed":
      writeCachedSettings(event.data);
      return { ...state, settings: event.data };
    case "press-ignored": {
      const id = `${Date.now()}-${Math.random()}`;
      const reason = event.data.reason;
      const msg = `Press from ${event.data.deviceName} ignored — ${reason}`;
      return {
        ...state,
        toasts: [...state.toasts, { id, message: msg, kind: "press-ignored" }],
      };
    }
    case "mqtt-discover-message":
      return {
        ...state,
        discovery: [
          ...state.discovery.filter((d) => d.topic !== event.data.topic),
          event.data,
        ],
      };
    case "round-complete":
      // No-op locally; phase-changed and turn-switched follow.
      return state;
  }
}

function reducer(state: ReducerState, action: ReducerAction): ReducerState {
  switch (action.type) {
    case "SET_GAME":
      return { ...state, game: action.state };
    case "SET_SETTINGS":
      writeCachedSettings(action.settings);
      return { ...state, settings: action.settings };
    case "ADD_TOAST":
      return { ...state, toasts: [...state.toasts, action.toast] };
    case "REMOVE_TOAST":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case "SET_STALE":
      return { ...state, staleSince: action.since };
    case "SSE_EVENT":
      return applySse(state, action.event);
    case "ADD_DISCOVERY":
      return {
        ...state,
        discovery: [
          ...state.discovery.filter((d) => d.topic !== action.msg.topic),
          action.msg,
        ],
      };
    case "CLEAR_DISCOVERY":
      return { ...state, discovery: [] };
  }
}

export type LiveStateHook = {
  game: GameState | null;
  settings: AppSettings | null;
  toasts: Toast[];
  staleSince: number | null;
  discovery: DiscoveryMessage[];
  dismissToast: (id: string) => void;
  setSettings: (settings: AppSettings) => void;
  clearDiscovery: () => void;
};

export function useLiveState(): LiveStateHook {
  const [state, dispatch] = useReducer(reducer, {
    game: null,
    settings: readCachedSettings(),
    toasts: [],
    staleSince: null,
    discovery: [],
  });
  const failureCount = useRef(0);
  const [, forceRender] = useState(0);
  void forceRender;

  useEffect(() => {
    let canceled = false;

    // Initial fetches
    void (async () => {
      try {
        const [g, s] = await Promise.all([api.getState(), api.getSettings()]);
        if (canceled) return;
        dispatch({ type: "SET_GAME", state: g });
        dispatch({ type: "SET_SETTINGS", settings: s });
      } catch {
        /* SSE 'state' event will populate */
      }
    })();

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;

    const handleEvent = (eventName: SseEvent["event"], data: unknown) => {
      dispatch({ type: "SSE_EVENT", event: { event: eventName, data } as SseEvent });
    };

    const connect = () => {
      es = new EventSource("/api/session/stream");
      es.onopen = () => {
        failureCount.current = 0;
        if (staleTimer) clearTimeout(staleTimer);
        staleTimer = null;
        dispatch({ type: "SET_STALE", since: null });
      };
      es.onerror = () => {
        es?.close();
        if (!staleTimer) {
          staleTimer = setTimeout(() => {
            dispatch({ type: "SET_STALE", since: Date.now() });
          }, 1_000);
        }
        const delay =
          BACKOFF_SCHEDULE_MS[
            Math.min(failureCount.current, BACKOFF_SCHEDULE_MS.length - 1)
          ] ?? 5_000;
        failureCount.current += 1;
        reconnectTimer = setTimeout(() => {
          if (!canceled) connect();
        }, delay);
      };
      const names: SseEvent["event"][] = [
        "state",
        "tick",
        "phase-changed",
        "turn-switched",
        "round-complete",
        "alert-raised",
        "alert-cleared",
        "press-ignored",
        "settings-changed",
        "mqtt-status",
        "mqtt-discover-message",
      ];
      for (const name of names) {
        es.addEventListener(name, (ev) => {
          try {
            const data: unknown = JSON.parse((ev as MessageEvent).data);
            handleEvent(name, data);
          } catch {
            /* ignore parse errors */
          }
        });
      }
    };

    connect();

    return () => {
      canceled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (staleTimer) clearTimeout(staleTimer);
      es?.close();
    };
  }, []);

  // Auto-dismiss toasts after 3s.
  useEffect(() => {
    if (state.toasts.length === 0) return;
    const first = state.toasts[0];
    if (!first) return;
    const id = first.id;
    const timer = setTimeout(() => dispatch({ type: "REMOVE_TOAST", id }), 3_000);
    return () => clearTimeout(timer);
  }, [state.toasts]);

  return {
    game: state.game,
    settings: state.settings,
    toasts: state.toasts,
    staleSince: state.staleSince,
    discovery: state.discovery,
    dismissToast: (id) => dispatch({ type: "REMOVE_TOAST", id }),
    setSettings: (settings) => dispatch({ type: "SET_SETTINGS", settings }),
    clearDiscovery: () => dispatch({ type: "CLEAR_DISCOVERY" }),
  };
}
