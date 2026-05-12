import {
  badRequest,
  errorResponse,
  handleError,
  noContent,
  ok,
  readJson,
} from "@/server/api/respond";
import { isString, isStringArray } from "@/server/api/validators";
import { applySettingsChange, getAppSettings, getGame, lockedDeviceIds } from "@/server/game";
import type { DevicePatch } from "@/server/settings/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await readJson(req);
    if (!body || typeof body !== "object") return badRequest("body must be an object");
    const patch: DevicePatch = {};
    const obj = body as Record<string, unknown>;
    if (obj["name"] !== undefined) {
      if (!isString(obj["name"])) return badRequest("name must be a string");
      patch.name = obj["name"];
    }
    if (obj["topic"] !== undefined) {
      if (!isString(obj["topic"])) return badRequest("topic must be a string");
      patch.topic = obj["topic"];
    }
    if (obj["acceptedActions"] !== undefined) {
      if (obj["acceptedActions"] === null) {
        patch.acceptedActions = null;
      } else {
        if (!isStringArray(obj["acceptedActions"]))
          return badRequest("acceptedActions must be string[]");
        if (obj["acceptedActions"].length === 0)
          return badRequest("acceptedActions cannot be empty (use null to clear)");
        patch.acceptedActions = obj["acceptedActions"];
      }
    }
    const prev = getAppSettings();
    const updated = getGame().repo.updateDevice(id, patch, lockedDeviceIds());
    if (!updated) return errorResponse("unknown-device", `Unknown device ${id}`);
    applySettingsChange(getAppSettings(), prev);
    return ok(updated);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const prev = getAppSettings();
    const removed = getGame().repo.deleteDevice(id, lockedDeviceIds());
    if (!removed) return errorResponse("unknown-device", `Unknown device ${id}`);
    applySettingsChange(getAppSettings(), prev);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
