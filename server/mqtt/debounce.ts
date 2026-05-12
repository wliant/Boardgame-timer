// Per-device 500 ms debounce. Keyed by device id (not topic).

import type { EpochMs, Id } from "@/shared/types";

const DEBOUNCE_MS = 500;

export class PressDebouncer {
  private readonly lastAcceptedAt = new Map<Id, EpochMs>();

  /** Returns true if the press should be accepted; updates state if so. */
  accept(deviceId: Id, now: EpochMs): boolean {
    const last = this.lastAcceptedAt.get(deviceId);
    if (last !== undefined && now - last < DEBOUNCE_MS) return false;
    this.lastAcceptedAt.set(deviceId, now);
    return true;
  }

  /** Drop debounce state for a device (e.g. on delete/topic change). */
  forget(deviceId: Id): void {
    this.lastAcceptedAt.delete(deviceId);
  }

  clear(): void {
    this.lastAcceptedAt.clear();
  }
}
