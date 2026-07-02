import { sql, ensureSchema } from "../../../lib/db";
import { hashPassword, createSession } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    await ensureSchema();
    const { email, password, name } = await request.json();

    const e = (email || "").trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
      return Response.json({ ok: false, error: "Enter a valid email." }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return Response.json({ ok: false, error: "Password must be at least 6 characters." }, { status: 400 });
    }

    const existing = await sql`SELECT id FROM users WHERE email = ${e}`;
    if (existing.length) {
      return Response.json({ ok: false, error: "An account with this email already exists." }, { status: 409 });
    }

    const hash = await hashPassword(password);
    const rows = await sql`
      INSERT INTO users (email, password_hash, name)
      VALUES (${e}, ${hash}, ${(name || "").trim() || null})
      RETURNING id, email, name
    `;
    const user = rows[0];
    await sql`INSERT INTO profiles (user_id) VALUES (${user.id}) ON CONFLICT DO NOTHING`;
    await createSession(user);

    return Response.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    return Response.json({ ok: false, error: err.message || "Registration failed" }, { status: 500 });
  }
}
