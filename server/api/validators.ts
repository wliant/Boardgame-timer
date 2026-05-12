// Lightweight runtime validators for API request payloads.

import type { GameConfig, PlayerConfig } from "@/shared/types";

export function isString(x: unknown): x is string {
  return typeof x === "string";
}

export function isFiniteInt(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && Number.isInteger(x);
}

export function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

export function asPlayerConfig(input: unknown): PlayerConfig | string {
  if (!input || typeof input !== "object") return "player must be an object";
  const obj = input as Record<string, unknown>;
  if (!isString(obj["id"])) return "player.id must be a string";
  if (!isString(obj["name"])) return "player.name must be a string";
  if (!isFiniteInt(obj["timeBudgetMs"])) return "player.timeBudgetMs must be an integer";
  const dev = obj["assignedDeviceId"];
  if (dev !== null && typeof dev !== "string")
    return "player.assignedDeviceId must be string or null";
  return {
    id: obj["id"],
    name: obj["name"],
    timeBudgetMs: obj["timeBudgetMs"],
    assignedDeviceId: dev === null ? null : (dev as string),
  };
}

export function asGameConfig(input: unknown): GameConfig | string {
  if (!input || typeof input !== "object") return "config must be an object";
  const obj = input as Record<string, unknown>;
  if (!isString(obj["mode"])) return "mode must be a string";
  if (!isString(obj["endOfTurnTrigger"])) return "endOfTurnTrigger must be a string";
  if (!isString(obj["turnOrderMode"])) return "turnOrderMode must be a string";
  if (!Array.isArray(obj["players"])) return "players must be an array";
  const players: PlayerConfig[] = [];
  for (const p of obj["players"]) {
    const result = asPlayerConfig(p);
    if (typeof result === "string") return result;
    players.push(result);
  }
  const mode = obj["mode"];
  const trigger = obj["endOfTurnTrigger"];
  const order = obj["turnOrderMode"];
  if (mode !== "total-time" && mode !== "turn-by-turn")
    return "mode must be total-time or turn-by-turn";
  if (trigger !== "screen-tap" && trigger !== "physical-button")
    return "endOfTurnTrigger must be screen-tap or physical-button";
  if (order !== "fixed" && order !== "rotating")
    return "turnOrderMode must be fixed or rotating";
  return { mode, endOfTurnTrigger: trigger, turnOrderMode: order, players };
}
