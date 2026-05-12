// AppSettings + device repository on top of better-sqlite3.
// See specs/09-persistence.md.

import { randomUUID } from "node:crypto";

import type { Database as Db } from "better-sqlite3";

import type { AppSettings, Device, EpochMs, Id } from "@/shared/types";

type AppSettingsRow = {
  id: number;
  broker_url: string;
  broker_user: string | null;
  broker_pass: string | null;
  client_id: string;
  updated_at: number;
};

export type DevicePatch = {
  name?: string;
  topic?: string;
  /** undefined = unchanged; null = clear to "any non-empty qualifies". */
  acceptedActions?: string[] | null;
};

type DeviceRow = {
  id: string;
  name: string;
  topic: string;
  accepted_actions: string | null;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
};

function deviceRowToDevice(row: DeviceRow): Device {
  const out: Device = { id: row.id, name: row.name, topic: row.topic };
  if (row.accepted_actions != null) {
    try {
      const parsed = JSON.parse(row.accepted_actions) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        out.acceptedActions = parsed;
      }
    } catch {
      // ignore malformed JSON
    }
  }
  if (row.last_seen_at != null) {
    out.lastSeenAt = row.last_seen_at;
  }
  return out;
}

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  getAppSettings(): AppSettings {
    const row = this.db
      .prepare("SELECT * FROM app_settings WHERE id = 1")
      .get() as AppSettingsRow;
    const devices = (
      this.db.prepare("SELECT * FROM devices ORDER BY created_at").all() as DeviceRow[]
    ).map(deviceRowToDevice);
    const mqttBroker: AppSettings["mqttBroker"] = {
      url: row.broker_url,
      clientId: row.client_id,
    };
    if (row.broker_user != null) mqttBroker.username = row.broker_user;
    if (row.broker_pass != null) mqttBroker.password = row.broker_pass;
    return { mqttBroker, devices };
  }

  putAppSettings(input: AppSettings, lockedDeviceIds: Set<Id>): AppSettings {
    const now: EpochMs = Date.now();
    const existing = this.db
      .prepare("SELECT id FROM devices")
      .all() as { id: string }[];
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(input.devices.map((d) => d.id));

    for (const id of existingIds) {
      if (!incomingIds.has(id) && lockedDeviceIds.has(id)) {
        const err = new Error(`Device ${id} is in use by the current game`);
        (err as Error & { code?: string }).code = "device-in-use";
        throw err;
      }
    }

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE app_settings
           SET broker_url = ?, broker_user = ?, broker_pass = ?, client_id = ?, updated_at = ?
           WHERE id = 1`,
        )
        .run(
          input.mqttBroker.url,
          input.mqttBroker.username ?? null,
          input.mqttBroker.password ?? null,
          input.mqttBroker.clientId,
          now,
        );

      for (const id of existingIds) {
        if (!incomingIds.has(id)) {
          this.db.prepare("DELETE FROM devices WHERE id = ?").run(id);
        }
      }

      for (const d of input.devices) {
        const acceptedJson =
          d.acceptedActions !== undefined ? JSON.stringify(d.acceptedActions) : null;
        if (existingIds.has(d.id)) {
          this.db
            .prepare(
              `UPDATE devices SET name = ?, topic = ?, accepted_actions = ?, updated_at = ? WHERE id = ?`,
            )
            .run(d.name, d.topic, acceptedJson, now, d.id);
        } else {
          this.db
            .prepare(
              `INSERT INTO devices (id, name, topic, accepted_actions, last_seen_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, NULL, ?, ?)`,
            )
            .run(d.id, d.name, d.topic, acceptedJson, now, now);
        }
      }
    });
    tx();
    return this.getAppSettings();
  }

  listDevices(): Device[] {
    return (
      this.db.prepare("SELECT * FROM devices ORDER BY created_at").all() as DeviceRow[]
    ).map(deviceRowToDevice);
  }

  getDevice(id: Id): Device | null {
    const row = this.db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(id) as DeviceRow | undefined;
    return row ? deviceRowToDevice(row) : null;
  }

  createDevice(input: Omit<Device, "id"> & { id?: Id }): Device {
    const id = input.id ?? randomUUID();
    const now: EpochMs = Date.now();
    const acceptedJson =
      input.acceptedActions !== undefined ? JSON.stringify(input.acceptedActions) : null;
    this.db
      .prepare(
        `INSERT INTO devices (id, name, topic, accepted_actions, last_seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(id, input.name, input.topic, acceptedJson, now, now);
    return this.getDevice(id)!;
  }

  updateDevice(
    id: Id,
    patch: DevicePatch,
    lockedDeviceIds: Set<Id>,
  ): Device | null {
    const existing = this.getDevice(id);
    if (!existing) return null;
    if (
      patch.topic !== undefined &&
      patch.topic !== existing.topic &&
      lockedDeviceIds.has(id)
    ) {
      const err = new Error(`Cannot change topic of in-use device ${id}`);
      (err as Error & { code?: string }).code = "device-in-use";
      throw err;
    }
    const name = patch.name ?? existing.name;
    const topic = patch.topic ?? existing.topic;
    let actions: string[] | undefined;
    if (patch.acceptedActions === null) {
      actions = undefined;
    } else if (patch.acceptedActions !== undefined) {
      actions = patch.acceptedActions;
    } else {
      actions = existing.acceptedActions;
    }
    const acceptedJson = actions !== undefined ? JSON.stringify(actions) : null;
    this.db
      .prepare(
        `UPDATE devices SET name = ?, topic = ?, accepted_actions = ?, updated_at = ? WHERE id = ?`,
      )
      .run(name, topic, acceptedJson, Date.now(), id);
    return this.getDevice(id);
  }

  deleteDevice(id: Id, lockedDeviceIds: Set<Id>): boolean {
    const existing = this.getDevice(id);
    if (!existing) return false;
    if (lockedDeviceIds.has(id)) {
      const err = new Error(`Device ${id} is in use by the current game`);
      (err as Error & { code?: string }).code = "device-in-use";
      throw err;
    }
    this.db.prepare("DELETE FROM devices WHERE id = ?").run(id);
    return true;
  }

  touchDevice(id: Id, at: EpochMs): void {
    this.db
      .prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?")
      .run(at, id);
  }
}
