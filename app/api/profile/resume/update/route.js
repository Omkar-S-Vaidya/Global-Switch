import { sql, ensureSchema } from "../../../../lib/db";
import { getSession } from "../../../../lib/auth";
import { appendSkillsPage } from "../../../../lib/resumePdf";

export const dynamic = "force-dynamic";

// Regenerates the stored resume as: original PDF + an appended "Skills" page
// listing the user's current profile skills. Always rebuilds from the pristine
// original so it never accumulates pages.
export async function POST() {
  const s = await getSession();
  if (!s) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  await ensureSchema();
  const rows = await sql`
    SELECT resume_name, resume_type, resume_b64, resume_orig_b64, skills
    FROM profiles WHERE user_id = ${s.uid}
  `;
  const p = rows[0];
  if (!p || !p.resume_b64) {
    return Response.json({ ok: false, error: "No résumé on file to update." }, { status: 400 });
  }
  const skills = p.skills || [];
  if (!skills.length) {
    return Response.json({ ok: false, error: "Add some skills to your profile first." }, { status: 400 });
  }
  if (!/pdf/i.test(p.resume_type || "")) {
    return Response.json({
      ok: false,
      code: "notpdf",
      error: "Updating the résumé file is only supported for PDF resumes — your skills are still saved to your profile.",
    });
  }

  const orig = p.resume_orig_b64 || p.resume_b64;
  let updated;
  try {
    updated = await appendSkillsPage(orig, skills);
  } catch (e) {
    return Response.json({ ok: false, error: "Couldn't update the PDF: " + (e?.message || e) }, { status: 500 });
  }

  const base = (p.resume_name || "resume").replace(/\.[^.]+$/, "").replace(/ \(updated\)$/, "");
  const newName = `${base} (updated).pdf`;
  await sql`
    UPDATE profiles
    SET resume_b64 = ${updated}, resume_orig_b64 = ${orig}, resume_name = ${newName},
        resume_type = 'application/pdf', updated_at = now()
    WHERE user_id = ${s.uid}
  `;
  return Response.json({ ok: true, resumeName: newName, skillCount: skills.length });
}
