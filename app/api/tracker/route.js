import { sql, ensureSchema } from "../../lib/db";
import { getSession } from "../../lib/auth";

export const dynamic = "force-dynamic";

// Returns the user's whole tracker as a map: { [jobKey]: {status, notes, resume} }.
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  await ensureSchema();
  const rows = await sql`
    SELECT job_key, status, notes, resume_version
    FROM job_tracker WHERE user_id = ${s.uid}
  `;
  const tracker = {};
  for (const r of rows) {
    tracker[r.job_key] = { status: r.status, notes: r.notes || "", resume: r.resume_version || "" };
  }
  return Response.json({ ok: true, tracker });
}

// Upsert one job's tracking. Only the fields present in `patch` are changed; the
// rest keep their stored value (COALESCE), so a status change won't wipe notes.
export async function PUT(request) {
  const s = await getSession();
  if (!s) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  await ensureSchema();
  const { jobKey, patch } = await request.json();
  if (!jobKey) return Response.json({ ok: false, error: "jobKey is required" }, { status: 400 });

  const status = patch?.status ?? null;
  const notes = patch?.notes ?? null;
  const resume = patch?.resume ?? null;

  await sql`
    INSERT INTO job_tracker (user_id, job_key, status, notes, resume_version, updated_at)
    VALUES (${s.uid}, ${jobKey}, ${status ?? "none"}, ${notes ?? ""}, ${resume ?? ""}, now())
    ON CONFLICT (user_id, job_key) DO UPDATE SET
      status = COALESCE(${status}, job_tracker.status),
      notes = COALESCE(${notes}, job_tracker.notes),
      resume_version = COALESCE(${resume}, job_tracker.resume_version),
      updated_at = now()
  `;
  return Response.json({ ok: true });
}
