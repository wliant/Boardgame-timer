import { handleError, ok } from "@/server/api/respond";
import { dispatch } from "@/server/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST() {
  try {
    return ok(dispatch({ type: "Resume" }));
  } catch (err) {
    return handleError(err);
  }
}
