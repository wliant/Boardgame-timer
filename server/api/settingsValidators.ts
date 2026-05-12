// Validators for AppSettings + Device payloads.

import type { AppSettings, Device, MqttBrokerConfig } from "@/shared/types";

import { isString, isStringArray } from "./validators";

export function asMqttBroker(input: unknown): MqttBrokerConfig | string {
  if (!input || typeof input !== "object") return "mqttBroker must be an object";
  const obj = input as Record<string, unknown>;
  if (!isString(obj["url"])) return "mqttBroker.url must be a string";
  if (!isString(obj["clientId"])) return "mqttBroker.clientId must be a string";
  const out: MqttBrokerConfig = { url: obj["url"], clientId: obj["clientId"] };
  const u = obj["username"];
  if (u !== undefined && u !== null) {
    if (!isString(u)) return "mqttBroker.username must be a string";
    out.username = u;
  }
  const p = obj["password"];
  if (p !== undefined && p !== null) {
    if (!isString(p)) return "mqttBroker.password must be a string";
    out.password = p;
  }
  return out;
}

export function asDevice(input: unknown, requireId: boolean): Device | string {
  if (!input || typeof input !== "object") return "device must be an object";
  const obj = input as Record<string, unknown>;
  if (requireId && !isString(obj["id"])) return "device.id must be a string";
  if (!isString(obj["name"])) return "device.name must be a string";
  if (obj["name"].trim().length === 0 || obj["name"].length > 40)
    return "device.name must be 1-40 chars";
  if (!isString(obj["topic"])) return "device.topic must be a string";
  if (obj["topic"].trim().length === 0) return "device.topic must be non-empty";
  const id = isString(obj["id"]) ? obj["id"] : "";
  const out: Device = {
    id,
    name: obj["name"],
    topic: obj["topic"],
  };
  const aa = obj["acceptedActions"];
  if (aa !== undefined && aa !== null) {
    if (!isStringArray(aa)) return "device.acceptedActions must be string[]";
    if (aa.length === 0) return "device.acceptedActions cannot be empty";
    out.acceptedActions = aa;
  }
  const ls = obj["lastSeenAt"];
  if (ls !== undefined && ls !== null) {
    if (typeof ls !== "number") return "device.lastSeenAt must be a number";
    out.lastSeenAt = ls;
  }
  return out;
}

export function asAppSettings(input: unknown): AppSettings | string {
  if (!input || typeof input !== "object") return "settings must be an object";
  const obj = input as Record<string, unknown>;
  const broker = asMqttBroker(obj["mqttBroker"]);
  if (typeof broker === "string") return broker;
  if (!Array.isArray(obj["devices"])) return "devices must be an array";
  const devices: Device[] = [];
  const seenIds = new Set<string>();
  for (const d of obj["devices"]) {
    const parsed = asDevice(d, true);
    if (typeof parsed === "string") return parsed;
    if (seenIds.has(parsed.id)) return `duplicate device id ${parsed.id}`;
    seenIds.add(parsed.id);
    devices.push(parsed);
  }
  return { mqttBroker: broker, devices };
}
