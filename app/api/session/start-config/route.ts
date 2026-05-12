import { handleError, ok } from "@/server/api/respond";
import { dispatch } from "@/server/game";
import { defaultConfig } from "@/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST() {
  try {
    return ok(dispatch({ type: "StartNewSession", config: defaultConfig() }));
  } catch (err) {
    return handleError(err);
  }
}
