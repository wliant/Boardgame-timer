// Throttled `last_seen_at` writer. ≤1 write per device per 5s.

import type { EpochMs, Id } from "@/shared/types";

import type { SettingsRepo } from "./repo";

const THROTTLE_MS = 5_000;

export class LastSeenThrottle {
  private readonly lastWriteAt = new Map<Id, EpochMs>();

  constructor(private readonly repo: SettingsRepo) {}

  touch(deviceId: Id, now: EpochMs = Date.now()): void {
    const prev = this.lastWriteAt.get(deviceId);
    if (prev !== undefined && now - prev < THROTTLE_MS) return;
    this.lastWriteAt.set(deviceId, now);
    try {
      this.repo.touchDevice(deviceId, now);
    } catch {
      // best-effort; non-fatal
    }
  }
}
