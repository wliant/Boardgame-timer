// Publish a synthetic button press to the configured MQTT broker.
// Usage: pnpm fake-button --topic <topic> --action <action> [--url <broker-url>]

import { connect } from "mqtt";

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
const url = args["url"] ?? process.env["BGT_MQTT_DEFAULT_URL"] ?? "mqtt://localhost:1883";

const client = connect(url, { connectTimeout: 5_000 });

client.on("connect", () => {
  const payload = JSON.stringify({ action });
  client.publish(topic, payload, { qos: 0 }, (err) => {
    if (err) {
      console.error(`Publish failed: ${err.message}`);
      process.exit(1);
    }
    console.log(`Published "${payload}" to ${topic}`);
    client.end(false, {}, () => process.exit(0));
  });
});

client.on("error", (err) => {
  console.error(`MQTT error: ${err.message}`);
  process.exit(1);
});
