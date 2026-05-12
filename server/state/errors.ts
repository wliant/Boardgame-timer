// Domain-level errors thrown by the reducer; mapped to ApiError envelope in
// route handlers per specs/06-server-api.md.

export type DomainErrorCode =
  | "invalid-phase"
  | "invalid-config"
  | "invalid-order"
  | "mqtt-not-connected"
  | "nothing-to-undo"
  | "unknown-player"
  | "unknown-device"
  | "device-in-use"
  | "bad-request";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: unknown;

  constructor(code: DomainErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
