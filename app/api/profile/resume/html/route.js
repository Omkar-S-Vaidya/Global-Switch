import { sql, ensureSchema } from "../../../../lib/db";
import { getSession } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

const MAX_B64 = 12 * 1024 * 1024; // ~9 MB generated PDF
const MAX_DATA = 4 * 1024 * 1024; // structured data incl. photo dataURL

// Stores the edited résumé: structured template data (editable source of truth)
// + a PDF generated from it on the client (served for download/apply).
export async function PUT(request) {
  const s = await getSession();
  if (!s) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  await ensureSchema();
  const body = await request.json();
  const data = body.data;
  const pdfB64 = (body.pdfB64 || "").toString();

  if (!data || typeof data !== "object") {
    return Response.json({ ok: false, error: "Nothing to save." }, { status: 400 });
  }
  const dataJson = JSON.stringify(data);
  if (dataJson.length > MAX_DATA) {
    return Response.json({ ok: false, error: "Résumé data is too large (try a smaller photo)." }, { status: 413 });
  }
  if (!pdfB64) return Response.json({ ok: false, error: "Missing generated PDF." }, { status: 400 });
  if (pdfB64.length > MAX_B64) {
    return Response.json({ ok: false, error: "Generated PDF is too large." }, { status: 413 });
  }

  const rows = await sql`SELECT resume_name FROM profiles WHERE user_id = ${s.uid}`;
  const base = (rows[0]?.resume_name || "resume")
    .replace(/\.[^.]+$/, "")
    .replace(/ \((edited|updated)\)$/, "");
  const newName = `${base} (edited).pdf`;

  await sql`
    INSERT INTO profiles (user_id, resume_data, resume_b64, resume_type, resume_name, updated_at)
    VALUES (${s.uid}, ${dataJson}::jsonb, ${pdfB64}, 'application/pdf', ${newName}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      resume_data = EXCLUDED.resume_data,
      resume_b64 = EXCLUDED.resume_b64,
      resume_type = EXCLUDED.resume_type,
      resume_name = EXCLUDED.resume_name,
      updated_at = now()
  `;
  return Response.json({ ok: true, resumeName: newName });
}
