// better-sqlite3 connection + schema bootstrap. See specs/09-persistence.md.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database, { type Database as Db } from "better-sqlite3";

const DDL = `
CREATE TABLE IF NOT EXISTS app_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  broker_url  TEXT    NOT NULL,
  broker_user TEXT,
  broker_pass TEXT,
  client_id   TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id                TEXT    PRIMARY KEY,
  name              TEXT    NOT NULL,
  topic             TEXT    NOT NULL,
  accepted_actions  TEXT,
  last_seen_at      INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_topic ON devices(topic);
`;

function ensureSingletonRow(db: Db): void {
  const row = db.prepare("SELECT id FROM app_settings WHERE id = 1").get();
  if (row) return;
  const clientId = `boardgame-timer-${randomBytes(2).toString("hex").toUpperCase()}`;
  const defaultUrl = process.env["BGT_MQTT_DEFAULT_URL"] ?? "";
  db.prepare(
    `INSERT INTO app_settings (id, broker_url, broker_user, broker_pass, client_id, updated_at)
     VALUES (1, ?, NULL, NULL, ?, ?)`,
  ).run(defaultUrl, clientId, Date.now());
}

export function openDb(path?: string): Db {
  const dbPath = path ?? process.env["BGT_DB_PATH"] ?? "./data/settings.db";
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(DDL);
  ensureSingletonRow(db);
  return db;
}
