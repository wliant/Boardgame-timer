import { badRequest, handleError, ok, readJson } from "@/server/api/respond";
import { isStringArray } from "@/server/api/validators";
import { dispatch } from "@/server/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as { data?: { playerIds?: unknown } } | undefined;
    const ids = body?.data?.playerIds;
    if (!isStringArray(ids)) {
      return badRequest("data.playerIds must be string[]");
    }
    return ok(dispatch({ type: "ConfirmNextRoundOrder", playerIds: ids }));
  } catch (err) {
    return handleError(err);
  }
}
