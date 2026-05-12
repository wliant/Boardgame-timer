// Vitest globalSetup hook for integration tests.
// Per specs/11-testing-and-dev.md it should spawn Mosquitto via
// `docker compose up -d mosquitto`, wait for the broker to accept connections
// (10-second timeout), and write a sentinel file. globalTeardown runs
// `docker compose down`. Implementation deferred until integration tests are wired.

export async function setup(): Promise<void> {
  // intentionally empty stub
}

export async function teardown(): Promise<void> {
  // intentionally empty stub
}
