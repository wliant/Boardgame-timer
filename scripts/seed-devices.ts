// Insert demo devices into the SQLite settings DB. Idempotent.

import { randomUUID } from "node:crypto";

import { openDb } from "../server/settings/db";

const demo = [
  { id: "fake-red", name: "Fake Red", topic: "boardgame-timer/test/red" },
  { id: "fake-blue", name: "Fake Blue", topic: "boardgame-timer/test/blue" },
  { id: "fake-green", name: "Fake Green", topic: "boardgame-timer/test/green" },
  { id: "fake-yellow", name: "Fake Yellow", topic: "boardgame-timer/test/yellow" },
];

const db = openDb();
const now = Date.now();

for (const d of demo) {
  const existing = db.prepare("SELECT id FROM devices WHERE id = ?").get(d.id);
  if (existing) {
    console.log(`already present: ${d.id}`);
    continue;
  }
  db.prepare(
    `INSERT INTO devices (id, name, topic, accepted_actions, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
  ).run(d.id, d.name, d.topic, now, now);
  console.log(`inserted: ${d.id} (${d.name})`);
}

// Sanity: also create a random-UUID device to demo non-fixed ids.
const randomId = randomUUID();
console.log(`(skipping random uuid demo: ${randomId})`);

process.exit(0);
