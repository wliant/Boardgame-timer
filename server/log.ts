// Minimal level-gated logger. Reads BGT_LOG_LEVEL.

type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): Level {
  const raw = (process.env["BGT_LOG_LEVEL"] ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function emit(level: Level, msg: string, meta?: unknown): void {
  if (order[level] < order[currentLevel()]) return;
  const line =
    meta === undefined
      ? `[${level}] ${msg}`
      : `[${level}] ${msg} ${JSON.stringify(meta)}`;
  const stream = level === "error" || level === "warn" ? "stderr" : "stdout";
  if (stream === "stderr") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, meta?: unknown) => emit("debug", msg, meta),
  info: (msg: string, meta?: unknown) => emit("info", msg, meta),
  warn: (msg: string, meta?: unknown) => emit("warn", msg, meta),
  error: (msg: string, meta?: unknown) => emit("error", msg, meta),
};
