// Vitest global setup for integration tests. Spawns Mosquitto via docker
// compose if available; otherwise falls back to an in-process aedes broker.
// Either way the broker listens on 127.0.0.1:1883 for the rest of the suite.

import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:net";

import { Aedes } from "aedes";

let aedesServer: Server | null = null;

async function tryDocker(): Promise<boolean> {
  const probe = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (probe.status !== 0) return false;
  const up = spawnSync("docker", ["compose", "up", "-d", "mosquitto"], {
    stdio: "ignore",
  });
  return up.status === 0;
}

async function startAedes(): Promise<void> {
  const aedes = await Aedes.createBroker();
  await new Promise<void>((resolve, reject) => {
    const server = createServer(aedes.handle);
    server.listen(1883, "127.0.0.1", () => {
      aedesServer = server;
      resolve();
    });
    server.on("error", reject);
  });
}

export async function setup(): Promise<void> {
  if (process.env["BGT_SKIP_MQTT_SETUP"]) return;
  const dockerOk = await tryDocker();
  if (dockerOk) return;
  await startAedes();
}

export async function teardown(): Promise<void> {
  if (aedesServer) {
    const srv = aedesServer;
    aedesServer = null;
    await Promise.race([
      new Promise<void>((resolve) => srv.close(() => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
    // Force close any lingering sockets.
    srv.unref();
  }
}
