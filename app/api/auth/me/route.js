import { getSession } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ ok: false, user: null }, { status: 401 });
  return Response.json({
    ok: true,
    user: { id: session.uid, email: session.email, name: session.name || null },
  });
}
