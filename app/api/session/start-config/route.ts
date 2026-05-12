import { handleError, ok } from "@/server/api/respond";
import { dispatch } from "@/server/game";
import { defaultConfig } from "@/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST() {
  try {
    dispatch({ type: "StartNewSession" });
    const state = dispatch({ type: "EditConfig", config: defaultConfig() });
    return ok(state);
  } catch (err) {
    return handleError(err);
  }
}
