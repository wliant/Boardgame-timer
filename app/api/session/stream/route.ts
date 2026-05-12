import { getSseChannel } from "@/server/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return getSseChannel().openResponse(req);
}
