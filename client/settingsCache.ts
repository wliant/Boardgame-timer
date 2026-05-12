// localStorage cache for AppSettings. See specs/09-persistence.md §"Browser cache".

import type { AppSettings } from "@/shared/types";

const KEY = "bgt.settings";
const SCHEMA_VERSION = 1;

type Envelope = { schemaVersion: number; data: AppSettings };

export function readCachedSettings(): AppSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope;
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return parsed.data;
  } catch {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function writeCachedSettings(data: AppSettings): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: Envelope = { schemaVersion: SCHEMA_VERSION, data };
    window.localStorage.setItem(KEY, JSON.stringify(envelope));
  } catch {
    /* ignore quota errors */
  }
}
