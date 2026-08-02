// The company database — the list you build once and check every day.
//
// GET    /api/companies            list + filter + per-bucket counts
// POST   /api/companies            add one company by hand
// PATCH  /api/companies            edit a company (partial)
// DELETE /api/companies?id=…       remove a company

import { sql, ensureSchema } from "../../lib/db";
import { getSession } from "../../lib/auth";
import { slugify } from "../../lib/companySeed";
import { boardUrl, ATS_TYPES } from "../../lib/ats";
import { BUCKET_KEYS } from "../../lib/buckets";

export const dynamic = "force-dynamic";

const unauthorized = () =>
  Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

// Optional filters are passed as NULL-or-value so a single static query covers
// every combination — no string-built SQL.
export async function GET(request) {
  const s = await getSession();
  if (!s) return unauthorized();
  await ensureSchema();

  const p = new URL(request.url).searchParams;
  const bucket = BUCKET_KEYS.includes(p.get("bucket")) ? p.get("bucket") : null;
  const visa = p.get("visa") || null;
  const remote = p.get("remote") || null;
  const q = (p.get("q") || "").trim() || null;
  const hiring = p.get("hiring") === "1";
  const withBoard = p.get("board") === "1";

  const rows = await sql`
    SELECT id, slug, name, site, bucket, sector, tier, ats, ats_token, careers_url,
           linkedin_url, visa, remote, size, notes, open_roles, new_roles,
           checked_at, probed_at, active
    FROM companies
    WHERE active = true
      AND (${bucket}::text IS NULL OR bucket = ${bucket})
      AND (${visa}::text IS NULL OR visa = ${visa})
      AND (${remote}::text IS NULL OR remote = ${remote})
      AND (${q}::text IS NULL OR name ILIKE '%' || ${q} || '%' OR sector ILIKE '%' || ${q} || '%')
      AND (${hiring} = false OR open_roles > 0)
      AND (${withBoard} = false OR ats IS NOT NULL)
    ORDER BY new_roles DESC, open_roles DESC, name ASC
  `;

  // Counts are over the whole database, not the filtered view, so the bucket
  // chips keep showing totals while you filter within one.
  const totals = await sql`
    SELECT bucket,
           COUNT(*)::int                                        AS total,
           COUNT(*) FILTER (WHERE ats IS NOT NULL)::int          AS with_board,
           COUNT(*) FILTER (WHERE open_roles > 0)::int           AS hiring,
           COALESCE(SUM(open_roles), 0)::int                     AS open_roles,
           COALESCE(SUM(new_roles), 0)::int                      AS new_roles
    FROM companies WHERE active = true GROUP BY bucket
  `;

  return Response.json({
    ok: true,
    companies: rows.map((r) => ({
      ...r,
      careersUrl: r.careers_url || boardUrl(r.ats, r.ats_token, r.site),
      atsToken: r.ats_token,
      linkedinUrl:
        r.linkedin_url ||
        `https://www.linkedin.com/company/${r.slug}/jobs/`,
      openRoles: r.open_roles,
      newRoles: r.new_roles,
      checkedAt: r.checked_at,
    })),
    counts: Object.fromEntries(totals.map((t) => [t.bucket, t])),
    atsTypes: ATS_TYPES,
  });
}

function clean(v) {
  const s = (v ?? "").toString().trim();
  return s || null;
}

export async function POST(request) {
  const s = await getSession();
  if (!s) return unauthorized();
  await ensureSchema();

  const b = await request.json().catch(() => ({}));
  const name = clean(b.name);
  if (!name) return Response.json({ ok: false, error: "name is required" }, { status: 400 });
  const bucket = BUCKET_KEYS.includes(b.bucket) ? b.bucket : "remote";
  const ats = ATS_TYPES.includes(b.ats) ? b.ats : null;
  const token = ats ? clean(b.atsToken) : null;

  const site = clean(b.site)?.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;

  const [row] = await sql`
    INSERT INTO companies
      (slug, name, site, bucket, sector, tier, ats, ats_token, careers_url,
       linkedin_url, visa, remote, size, notes, added_by)
    VALUES
      (${slugify(name)}, ${name}, ${site}, ${bucket}, ${clean(b.sector)},
       ${clean(b.tier) || "growing-mnc"}, ${ats}, ${token},
       ${clean(b.careersUrl) || boardUrl(ats, token, site)}, ${clean(b.linkedinUrl)},
       ${clean(b.visa) || "unknown"}, ${clean(b.remote) || "unknown"}, ${clean(b.size)},
       ${b.notes || ""}, ${s.uid})
    ON CONFLICT (slug) DO UPDATE SET
      active = true, bucket = EXCLUDED.bucket, updated_at = now()
    RETURNING id, slug, name
  `;
  return Response.json({ ok: true, company: row });
}

export async function PATCH(request) {
  const s = await getSession();
  if (!s) return unauthorized();
  await ensureSchema();

  const b = await request.json().catch(() => ({}));
  const id = Number(b.id);
  if (!id) return Response.json({ ok: false, error: "id is required" }, { status: 400 });

  // Only the keys present in the body change; the rest keep their stored value.
  const ats = b.ats === null ? null : ATS_TYPES.includes(b.ats) ? b.ats : undefined;
  await sql`
    UPDATE companies SET
      name         = COALESCE(${clean(b.name)}, name),
      bucket       = COALESCE(${BUCKET_KEYS.includes(b.bucket) ? b.bucket : null}, bucket),
      sector       = COALESCE(${clean(b.sector)}, sector),
      tier         = COALESCE(${clean(b.tier)}, tier),
      visa         = COALESCE(${clean(b.visa)}, visa),
      remote       = COALESCE(${clean(b.remote)}, remote),
      size         = COALESCE(${clean(b.size)}, size),
      site         = COALESCE(${clean(b.site)}, site),
      careers_url  = COALESCE(${clean(b.careersUrl)}, careers_url),
      linkedin_url = COALESCE(${clean(b.linkedinUrl)}, linkedin_url),
      notes        = COALESCE(${b.notes ?? null}, notes),
      ats          = COALESCE(${ats === undefined ? null : ats}, ats),
      ats_token    = COALESCE(${clean(b.atsToken)}, ats_token),
      new_roles    = CASE WHEN ${b.clearNew === true} THEN 0 ELSE new_roles END,
      updated_at   = now()
    WHERE id = ${id}
  `;
  return Response.json({ ok: true });
}

export async function DELETE(request) {
  const s = await getSession();
  if (!s) return unauthorized();
  await ensureSchema();

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return Response.json({ ok: false, error: "id is required" }, { status: 400 });
  // Soft delete — keeps any applications that reference the company intact.
  await sql`UPDATE companies SET active = false, updated_at = now() WHERE id = ${id}`;
  return Response.json({ ok: true });
}
