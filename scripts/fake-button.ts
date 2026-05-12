// scripts/fake-button.ts
// Publish a synthetic button press to the configured MQTT broker.
// Usage: pnpm fake-button --topic <topic> --action <action>
// Implementation deferred — currently logs intent and exits 0.

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== undefined && arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const topic = args["topic"] ?? "boardgame-timer/test/red";
const action = args["action"] ?? "single";

console.log(
  `[fake-button] would publish to topic="${topic}" action="${action}" (stub)`,
);
process.exit(0);
