// Per-user search settings — currently just the daily application target per
// bucket (defaults to 15 remote / 10 each country ≈ 275 a week).

import { sql, ensureSchema } from "../../lib/db";
import { getSession } from "../../lib/auth";
import { BUCKET_KEYS, DEFAULT_TARGETS } from "../../lib/buckets";

export const dynamic = "force-dynamic";

const unauthorized = () => Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();
  await ensureSchema();

  const rows = await sql`SELECT targets FROM user_settings WHERE user_id = ${s.uid}`;
  return Response.json({ ok: true, targets: { ...DEFAULT_TARGETS, ...(rows[0]?.targets || {}) } });
}

export async function PUT(request) {
  const s = await getSession();
  if (!s) return unauthorized();
  await ensureSchema();

  const body = await request.json().catch(() => ({}));
  const targets = {};
  for (const k of BUCKET_KEYS) {
    const n = Number(body.targets?.[k]);
    if (Number.isFinite(n)) targets[k] = Math.min(Math.max(Math.round(n), 0), 200);
  }

  await sql`
    INSERT INTO user_settings (user_id, targets, updated_at)
    VALUES (${s.uid}, ${JSON.stringify(targets)}::jsonb, now())
    ON CONFLICT (user_id) DO UPDATE SET targets = EXCLUDED.targets, updated_at = now()
  `;
  return Response.json({ ok: true, targets: { ...DEFAULT_TARGETS, ...targets } });
}
