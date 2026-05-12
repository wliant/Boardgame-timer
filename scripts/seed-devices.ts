// scripts/seed-devices.ts
// Insert demo devices (`fake-red`, `fake-blue`) into the SQLite settings DB.
// Implementation deferred — currently logs intent and exits 0.

const demo = [
  { id: "fake-red", name: "Fake Red", topic: "boardgame-timer/test/red" },
  { id: "fake-blue", name: "Fake Blue", topic: "boardgame-timer/test/blue" },
];

console.log("[seed-devices] would insert demo devices (stub):");
for (const d of demo) {
  console.log(`  - ${d.id}  name="${d.name}"  topic="${d.topic}"`);
}
process.exit(0);
