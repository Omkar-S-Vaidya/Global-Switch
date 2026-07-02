import { sql, ensureSchema } from "../../../lib/db";
import { verifyPassword, createSession } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    await ensureSchema();
    const { email, password } = await request.json();
    const e = (email || "").trim().toLowerCase();

    const rows = await sql`SELECT id, email, name, password_hash FROM users WHERE email = ${e}`;
    const user = rows[0];
    if (!user || !(await verifyPassword(password || "", user.password_hash))) {
      return Response.json({ ok: false, error: "Invalid email or password." }, { status: 401 });
    }

    await createSession(user);
    return Response.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    return Response.json({ ok: false, error: err.message || "Login failed" }, { status: 500 });
  }
}
