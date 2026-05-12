import { badRequest, handleError, ok, readJson } from "@/server/api/respond";
import { asGameConfig } from "@/server/api/validators";
import { dispatch } from "@/server/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  try {
    const body = (await readJson(req)) as { data?: unknown } | undefined;
    if (!body || body.data === undefined) {
      return badRequest("Body must be { data: GameConfig }");
    }
    const parsed = asGameConfig(body.data);
    if (typeof parsed === "string") {
      return badRequest(parsed);
    }
    const state = dispatch({ type: "EditConfig", config: parsed });
    return ok(state);
  } catch (err) {
    return handleError(err);
  }
}
