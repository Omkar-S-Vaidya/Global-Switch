// One job's description, on demand.
//
// The list endpoint deliberately ships no description text — doing so would turn
// a 735 KB response into roughly 12 MB. The full text is already in memory from
// the board fetch (it's what the skill extractor reads), so serving it here
// costs no outbound request: expanding a role is a local map lookup.
//
// A miss means the cache has rotated (10-minute TTL, or a server restart). The
// client falls back to opening the posting itself, which is the honest outcome —
// better than silently showing nothing.

import { getDescription } from "../../../lib/descCache";
import { getSession } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const session = await getSession();
  if (!session) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url).searchParams.get("url");
  if (!url) return Response.json({ ok: false, error: "url is required" }, { status: 400 });

  const desc = getDescription(url);
  if (!desc) {
    return Response.json({
      ok: true,
      found: false,
      description: null,
      reason: "Not cached — reload the board, or open the posting for the full text.",
    });
  }
  return Response.json({ ok: true, found: true, description: desc });
}
