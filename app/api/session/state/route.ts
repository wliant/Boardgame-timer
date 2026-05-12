import { ok } from "@/server/api/respond";
import { getState } from "@/server/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return ok(getState());
}
