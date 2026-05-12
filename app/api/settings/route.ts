import { badRequest, handleError, ok, readJson } from "@/server/api/respond";
import { asAppSettings } from "@/server/api/settingsValidators";
import { applySettingsChange, getAppSettings, getGame, lockedDeviceIds } from "@/server/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return ok(getAppSettings());
}

export async function PUT(req: Request) {
  try {
    const body = (await readJson(req)) as { data?: unknown } | undefined;
    if (!body || body.data === undefined) {
      return badRequest("Body must be { data: AppSettings }");
    }
    const parsed = asAppSettings(body.data);
    if (typeof parsed === "string") return badRequest(parsed);
    const prev = getAppSettings();
    const saved = getGame().repo.putAppSettings(parsed, lockedDeviceIds());
    applySettingsChange(saved, prev);
    return ok(saved);
  } catch (err) {
    return handleError(err);
  }
}
