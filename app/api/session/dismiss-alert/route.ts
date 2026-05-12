import { badRequest, handleError, ok, readJson } from "@/server/api/respond";
import { isString } from "@/server/api/validators";
import { dispatch } from "@/server/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as
      | { data?: { playerId?: unknown } }
      | undefined;
    const pid = body?.data?.playerId;
    if (!isString(pid)) return badRequest("data.playerId must be a string");
    return ok(dispatch({ type: "DismissAlert", playerId: pid }));
  } catch (err) {
    return handleError(err);
  }
}
