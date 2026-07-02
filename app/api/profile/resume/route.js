import { sql, ensureSchema } from "../../../lib/db";
import { getSession } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// Streams the stored resume file back for download/preview.
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  await ensureSchema();
  const rows = await sql`
    SELECT resume_name, resume_type, resume_b64 FROM profiles WHERE user_id = ${session.uid}
  `;
  const p = rows[0];
  if (!p || !p.resume_b64) return new Response("No resume on file", { status: 404 });

  const bytes = Buffer.from(p.resume_b64, "base64");
  const name = p.resume_name || "resume";
  return new Response(bytes, {
    headers: {
      "Content-Type": p.resume_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`,
      "Content-Length": String(bytes.length),
    },
  });
}
