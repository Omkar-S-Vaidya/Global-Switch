import { sql, ensureSchema } from "../../lib/db";
import { getSession } from "../../lib/auth";

export const dynamic = "force-dynamic";

// Roughly cap stored resume size (base64 is ~33% bigger than the file).
const MAX_B64 = 8 * 1024 * 1024; // ~6 MB file

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  await ensureSchema();
  const rows = await sql`
    SELECT current_salary, expected_salary, job_preference, skills,
           resume_name, resume_type, resume_text, resume_html, resume_data,
           (resume_b64 IS NOT NULL) AS has_resume, updated_at
    FROM profiles WHERE user_id = ${session.uid}
  `;
  const p = rows[0] || null;
  return Response.json({
    ok: true,
    profile: p
      ? {
          currentSalary: p.current_salary || "",
          expectedSalary: p.expected_salary || "",
          jobPreference: p.job_preference || "",
          skills: p.skills || [],
          resumeName: p.resume_name || "",
          resumeText: p.resume_text || "",
          resumeHtml: p.resume_html || "",
          resumeData: p.resume_data || null,
          hasResume: p.has_resume,
          updatedAt: p.updated_at,
        }
      : null,
  });
}

// Partial update — currently just the skill set, so the job board can keep the
// profile in sync when you upload a résumé or tap "add this skill" without
// blanking salary/preference the way a full PUT would.
export async function PATCH(request) {
  const session = await getSession();
  if (!session) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  await ensureSchema();
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.skills)) {
    return Response.json({ ok: false, error: "skills[] is required" }, { status: 400 });
  }
  const skills = body.skills.slice(0, 200);
  const name = body.resumeName ? String(body.resumeName).slice(0, 300) : null;

  await sql`
    INSERT INTO profiles (user_id, skills, resume_name, updated_at)
    VALUES (${session.uid}, ${JSON.stringify(skills)}::jsonb, ${name}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      skills      = EXCLUDED.skills,
      resume_name = COALESCE(EXCLUDED.resume_name, profiles.resume_name),
      updated_at  = now()
  `;
  return Response.json({ ok: true, skills });
}

export async function PUT(request) {
  const session = await getSession();
  if (!session) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  await ensureSchema();
  const body = await request.json();
  const currentSalary = (body.currentSalary || "").toString().slice(0, 120);
  const expectedSalary = (body.expectedSalary || "").toString().slice(0, 120);
  const jobPreference = (body.jobPreference || "").toString().slice(0, 2000);
  const skills = Array.isArray(body.skills) ? body.skills.slice(0, 200) : [];
  const resume = body.resume; // optional { name, type, b64, text }

  if (resume && resume.b64) {
    if (resume.b64.length > MAX_B64) {
      return Response.json({ ok: false, error: "Resume file is too large (max ~6 MB)." }, { status: 413 });
    }
    // A fresh upload resets the pristine original too.
    await sql`
      INSERT INTO profiles (user_id, current_salary, expected_salary, job_preference, skills,
                            resume_name, resume_type, resume_text, resume_b64, resume_orig_b64, updated_at)
      VALUES (${session.uid}, ${currentSalary}, ${expectedSalary}, ${jobPreference},
              ${JSON.stringify(skills)}::jsonb, ${resume.name || null}, ${resume.type || null},
              ${resume.text || null}, ${resume.b64}, ${resume.b64}, now())
      ON CONFLICT (user_id) DO UPDATE SET
        current_salary = EXCLUDED.current_salary,
        expected_salary = EXCLUDED.expected_salary,
        job_preference = EXCLUDED.job_preference,
        skills = EXCLUDED.skills,
        resume_name = EXCLUDED.resume_name,
        resume_type = EXCLUDED.resume_type,
        resume_text = EXCLUDED.resume_text,
        resume_b64 = EXCLUDED.resume_b64,
        resume_orig_b64 = EXCLUDED.resume_orig_b64,
        updated_at = now()
    `;
  } else {
    // No new file uploaded — keep the existing resume, update the rest.
    await sql`
      INSERT INTO profiles (user_id, current_salary, expected_salary, job_preference, skills, updated_at)
      VALUES (${session.uid}, ${currentSalary}, ${expectedSalary}, ${jobPreference},
              ${JSON.stringify(skills)}::jsonb, now())
      ON CONFLICT (user_id) DO UPDATE SET
        current_salary = EXCLUDED.current_salary,
        expected_salary = EXCLUDED.expected_salary,
        job_preference = EXCLUDED.job_preference,
        skills = EXCLUDED.skills,
        updated_at = now()
    `;
  }

  return Response.json({ ok: true });
}
