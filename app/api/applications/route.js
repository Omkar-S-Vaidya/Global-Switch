// Per-application tracking — one row per application, not one per company, so
// the same employer can be applied to repeatedly and each attempt keeps its own
// stage and follow-up date.
//
// GET returns the log plus everything the quota dashboard needs. Dates are
// evaluated against the CLIENT's local day (?today=YYYY-MM-DD): the server runs
// in UTC, and for an IST-based search a 1am application would otherwise be
// counted against the previous day.

import { sql, ensureSchema } from "../../lib/db";
import { getSession } from "../../lib/auth";
import { BUCKET_KEYS, DEFAULT_TARGETS, COUNTED_STATUSES, APP_STATUSES } from "../../lib/buckets";

export const dynamic = "force-dynamic";

const unauthorized = () => Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
const STATUS_KEYS = APP_STATUSES.map((s) => s.key);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function GET(request) {
  const s = await getSession();
  if (!s) return unauthorized();
  await ensureSchema();

  const p = new URL(request.url).searchParams;
  const today = isDate(p.get("today")) ? p.get("today") : new Date().toISOString().slice(0, 10);
  const bucket = BUCKET_KEYS.includes(p.get("bucket")) ? p.get("bucket") : null;
  const status = STATUS_KEYS.includes(p.get("status")) ? p.get("status") : null;
  const limit = Math.min(Number(p.get("limit")) || 200, 500);

  const [rows, byDay, statusCounts, settings] = await Promise.all([
    // DATE columns are cast to text: the driver would otherwise hydrate them as
    // JS Dates at local midnight and serialize back as UTC, landing a day early
    // for anyone east of Greenwich.
    sql`
      SELECT id, company_id, company_name, bucket, role_title, role_url, status,
             applied_on::text AS applied_on, follow_up_on::text AS follow_up_on,
             source, resume_version, notes, updated_at
      FROM applications
      WHERE user_id = ${s.uid}
        AND (${bucket}::text IS NULL OR bucket = ${bucket})
        AND (${status}::text IS NULL OR status = ${status})
      ORDER BY COALESCE(applied_on, created_at::date) DESC, id DESC
      LIMIT ${limit}
    `,
    // Per-bucket counts for today and the trailing 7 days, in one pass.
    sql`
      SELECT bucket,
             COUNT(*) FILTER (WHERE applied_on = ${today}::date)::int AS today,
             COUNT(*) FILTER (WHERE applied_on > ${today}::date - 7)::int AS week
      FROM applications
      WHERE user_id = ${s.uid} AND status = ANY(${COUNTED_STATUSES}::text[])
      GROUP BY bucket
    `,
    sql`
      SELECT status, COUNT(*)::int AS n FROM applications
      WHERE user_id = ${s.uid} GROUP BY status
    `,
    sql`SELECT targets FROM user_settings WHERE user_id = ${s.uid}`,
  ]);

  // Follow-ups that are due or overdue, oldest first — the daily "who do I
  // chase today" list.
  const followUps = await sql`
    SELECT id, company_name, bucket, role_title, role_url, status,
           applied_on::text AS applied_on, follow_up_on::text AS follow_up_on
    FROM applications
    WHERE user_id = ${s.uid}
      AND follow_up_on IS NOT NULL
      AND follow_up_on <= ${today}::date
      AND status IN ('applied', 'screening', 'interview')
    ORDER BY follow_up_on ASC
    LIMIT 50
  `;

  const targets = { ...DEFAULT_TARGETS, ...(settings[0]?.targets || {}) };
  const progress = Object.fromEntries(
    BUCKET_KEYS.map((k) => {
      const row = byDay.find((d) => d.bucket === k);
      return [k, { today: row?.today || 0, week: row?.week || 0, target: targets[k] ?? 0 }];
    })
  );

  return Response.json({
    ok: true,
    today,
    applications: rows,
    progress,
    targets,
    statusCounts: Object.fromEntries(statusCounts.map((r) => [r.status, r.n])),
    followUps,
  });
}

// Upsert on (user, company, role URL) — logging the same role twice edits the
// existing row instead of inflating the daily count.
export async function POST(request) {
  const s = await getSession();
  if (!s) return unauthorized();
  await ensureSchema();

  const b = await request.json().catch(() => ({}));
  const company = (b.companyName || "").trim();
  if (!company) return Response.json({ ok: false, error: "companyName is required" }, { status: 400 });

  const bucket = BUCKET_KEYS.includes(b.bucket) ? b.bucket : "remote";
  const status = STATUS_KEYS.includes(b.status) ? b.status : "applied";
  const appliedOn = isDate(b.appliedOn) ? b.appliedOn : null;
  const followUpOn = isDate(b.followUpOn) ? b.followUpOn : null;

  const [row] = await sql`
    INSERT INTO applications
      (user_id, company_id, company_name, bucket, role_title, role_url, status,
       applied_on, follow_up_on, source, resume_version, notes)
    VALUES
      (${s.uid}, ${b.companyId || null}, ${company}, ${bucket},
       ${b.roleTitle || ""}, ${b.roleUrl || ""}, ${status},
       ${appliedOn}, ${followUpOn}, ${b.source || ""}, ${b.resumeVersion || ""}, ${b.notes || ""})
    ON CONFLICT (user_id, company_name, role_url) DO UPDATE SET
      status         = EXCLUDED.status,
      bucket         = EXCLUDED.bucket,
      role_title     = COALESCE(NULLIF(EXCLUDED.role_title, ''), applications.role_title),
      applied_on     = COALESCE(EXCLUDED.applied_on, applications.applied_on),
      follow_up_on   = COALESCE(EXCLUDED.follow_up_on, applications.follow_up_on),
      source         = COALESCE(NULLIF(EXCLUDED.source, ''), applications.source),
      resume_version = COALESCE(NULLIF(EXCLUDED.resume_version, ''), applications.resume_version),
      notes          = COALESCE(NULLIF(EXCLUDED.notes, ''), applications.notes),
      updated_at     = now()
    RETURNING id
  `;
  return Response.json({ ok: true, id: row.id });
}

export async function PATCH(request) {
  const s = await getSession();
  if (!s) return unauthorized();
  await ensureSchema();

  const b = await request.json().catch(() => ({}));
  const id = Number(b.id);
  if (!id) return Response.json({ ok: false, error: "id is required" }, { status: 400 });

  const status = STATUS_KEYS.includes(b.status) ? b.status : null;
  // `clearFollowUp` exists because COALESCE can't distinguish "leave it" from
  // "set it back to null" — snoozing vs. dismissing a follow-up.
  await sql`
    UPDATE applications SET
      status         = COALESCE(${status}, status),
      role_title     = COALESCE(${b.roleTitle ?? null}, role_title),
      role_url       = COALESCE(${b.roleUrl ?? null}, role_url),
      bucket         = COALESCE(${BUCKET_KEYS.includes(b.bucket) ? b.bucket : null}, bucket),
      applied_on     = COALESCE(${isDate(b.appliedOn) ? b.appliedOn : null}::date, applied_on),
      follow_up_on   = CASE WHEN ${b.clearFollowUp === true} THEN NULL
                            ELSE COALESCE(${isDate(b.followUpOn) ? b.followUpOn : null}::date, follow_up_on) END,
      resume_version = COALESCE(${b.resumeVersion ?? null}, resume_version),
      notes          = COALESCE(${b.notes ?? null}, notes),
      updated_at     = now()
    WHERE id = ${id} AND user_id = ${s.uid}
  `;
  return Response.json({ ok: true });
}

export async function DELETE(request) {
  const s = await getSession();
  if (!s) return unauthorized();
  await ensureSchema();

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return Response.json({ ok: false, error: "id is required" }, { status: 400 });
  await sql`DELETE FROM applications WHERE id = ${id} AND user_id = ${s.uid}`;
  return Response.json({ ok: true });
}
