// Time formatting helpers per specs/08-ui-screens.md §"Time formatting".

export function formatDuration(ms: number): string {
  const negative = ms < 0;
  const abs = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hr = Math.floor(totalMin / 60);
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  let core: string;
  if (hr > 0) {
    core = `${hr}:${pad(min, 2)}:${pad(sec, 2)}`;
  } else {
    core = `${min}:${pad(sec, 2)}`;
  }
  return negative ? `-${core}` : core;
}

/** Parse "M:SS" or "H:MM:SS" or plain seconds. Returns null on failure. */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const parts = trimmed.split(":");
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (!Number.isFinite(m) || !Number.isFinite(s) || s < 0 || s >= 60) return null;
    return (m * 60 + s) * 1000;
  }
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    if (
      !Number.isFinite(h) ||
      !Number.isFinite(m) ||
      !Number.isFinite(s) ||
      m < 0 ||
      m >= 60 ||
      s < 0 ||
      s >= 60
    )
      return null;
    return ((h * 60 + m) * 60 + s) * 1000;
  }
  return null;
}
