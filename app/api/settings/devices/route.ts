import { badRequest, created, handleError, ok, readJson } from "@/server/api/respond";
import { asDevice } from "@/server/api/settingsValidators";
import { applySettingsChange, getAppSettings, getGame } from "@/server/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return ok(getGame().repo.listDevices());
}

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const parsed = asDevice(body, false);
    if (typeof parsed === "string") return badRequest(parsed);
    const prev = getAppSettings();
    const { id: _ignored, ...rest } = parsed;
    void _ignored;
    const inserted = getGame().repo.createDevice(rest);
    applySettingsChange(getAppSettings(), prev);
    return created(inserted);
  } catch (err) {
    return handleError(err);
  }
}
