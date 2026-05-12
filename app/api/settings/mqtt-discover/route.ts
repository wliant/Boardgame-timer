import { errorResponse, handleError, noContent, ok, readJson } from "@/server/api/respond";
import { isFiniteInt } from "@/server/api/validators";
import { getGame, getMqtt, getState } from "@/server/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const settings = getGame().repo.getAppSettings();
    if (!settings.mqttBroker.url || !getState().mqtt.connected) {
      return errorResponse(
        "mqtt-not-connected",
        "MQTT broker is not connected",
      );
    }
    const body = (await readJson(req)) as { windowMs?: unknown } | undefined;
    const requested = body?.windowMs;
    const max = Number(process.env["BGT_DISCOVERY_MAX_MS"] ?? 60_000);
    const windowMs = isFiniteInt(requested)
      ? Math.min(Math.max(requested, 1_000), max)
      : 15_000;
    const result = getMqtt().startDiscovery(windowMs);
    return ok({ windowMs: result.windowMs, endsAt: result.endsAt });
  } catch (err) {
    return handleError(err);
  }
}

export function GET() {
  return ok(getMqtt().getDiscoveryBuffer());
}

export function DELETE() {
  getMqtt().stopDiscovery();
  return noContent();
}
