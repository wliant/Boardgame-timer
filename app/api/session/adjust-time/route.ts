import { badRequest, handleError, ok, readJson } from "@/server/api/respond";
import { isFiniteInt, isString } from "@/server/api/validators";
import { dispatch } from "@/server/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as
      | { data?: { playerId?: unknown; deltaMs?: unknown } }
      | undefined;
    const pid = body?.data?.playerId;
    const dt = body?.data?.deltaMs;
    if (!isString(pid)) return badRequest("data.playerId must be a string");
    if (!isFiniteInt(dt)) return badRequest("data.deltaMs must be an integer");
    return ok(dispatch({ type: "AdjustTime", playerId: pid, deltaMs: dt }));
  } catch (err) {
    return handleError(err);
  }
}
