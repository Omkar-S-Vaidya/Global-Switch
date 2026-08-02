// Maintenance actions for the company database. All three are chunked and
// return `remaining`, so the UI drives them as a progress loop rather than one
// long request that would time out on serverless.
//
//   POST { action: "seed" }                  load the bundled 250-company list
//   POST { action: "probe",   limit: 10 }    discover which ATS each company uses
//   POST { action: "refresh", limit: 40 }    re-read boards, count new openings
//
// "New" openings are the whole point of the daily loop: refresh diffs each
// board's current role URLs against the set stored at the last check, so the
// database can tell you what appeared since yesterday instead of making you
// re-read every careers page.

import { sql, ensureSchema } from "../../../lib/db";
import { getSession } from "../../../lib/auth";
import { SEED, KNOWN_ATS, slugify, slugCandidates } from "../../../lib/companySeed";
import { readBoard, probeBoard, boardUrl, pool } from "../../../lib/ats";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROBE_STALE_DAYS = 30;

async function seed() {
  const rows = SEED.map(([name, site, bucket, sector, tier, visa, remote]) => {
    const [ats, token] = KNOWN_ATS[name] || [null, null];
    return {
      slug: slugify(name),
      name,
      site,
      bucket,
      sector,
      tier,
      visa,
      remote,
      ats,
      ats_token: token,
      careers_url: boardUrl(ats, token, site),
    };
  });

  // Single round trip. Existing rows keep their probed ATS token and role
  // counts — only the descriptive columns are refreshed from the seed.
  const [res] = await sql`
    WITH ins AS (
      INSERT INTO companies
        (slug, name, site, bucket, sector, tier, visa, remote, ats, ats_token, careers_url)
      SELECT s.slug, s.name, s.site, s.bucket, s.sector, s.tier, s.visa, s.remote,
             s.ats, s.ats_token, s.careers_url
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS s(
        slug text, name text, site text, bucket text, sector text, tier text,
        visa text, remote text, ats text, ats_token text, careers_url text
      )
      ON CONFLICT (slug) DO UPDATE SET
        name        = EXCLUDED.name,
        site        = COALESCE(EXCLUDED.site, companies.site),
        bucket      = EXCLUDED.bucket,
        sector      = EXCLUDED.sector,
        tier        = EXCLUDED.tier,
        visa        = EXCLUDED.visa,
        remote      = EXCLUDED.remote,
        ats         = COALESCE(companies.ats, EXCLUDED.ats),
        ats_token   = COALESCE(companies.ats_token, EXCLUDED.ats_token),
        careers_url = COALESCE(companies.careers_url, EXCLUDED.careers_url),
        active      = true,
        updated_at  = now()
      RETURNING xmax = 0 AS inserted
    )
    SELECT COUNT(*) FILTER (WHERE inserted)::int AS added,
           COUNT(*) FILTER (WHERE NOT inserted)::int AS updated
    FROM ins
  `;
  const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM companies WHERE active = true`;
  return { added: res.added, updated: res.updated, total };
}

async function probe(limit) {
  const candidates = await sql`
    SELECT id, name, site FROM companies
    WHERE active = true AND ats IS NULL
      AND (probed_at IS NULL OR probed_at < now() - ${`${PROBE_STALE_DAYS} days`}::interval)
    ORDER BY probed_at NULLS FIRST, id
    LIMIT ${limit}
  `;
  if (!candidates.length) {
    return { probed: 0, found: 0, remaining: 0, results: [] };
  }

  const results = await pool(candidates, 6, async (c) => {
    // Two slug shapes is enough for the overwhelming majority of boards, and
    // keeps a probe batch inside the request budget.
    const slugs = slugCandidates(c.name, c.site).slice(0, 2);
    const hit = await probeBoard(slugs);
    return { id: c.id, name: c.name, hit };
  });

  const found = results.filter((r) => r?.hit);
  if (found.length) {
    const payload = found.map((r) => ({
      id: r.id,
      ats: r.hit.ats,
      ats_token: r.hit.token,
      careers_url: boardUrl(r.hit.ats, r.hit.token, null),
    }));
    await sql`
      UPDATE companies c SET
        ats = u.ats, ats_token = u.ats_token,
        careers_url = COALESCE(c.careers_url, u.careers_url),
        probed_at = now(), updated_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
        AS u(id int, ats text, ats_token text, careers_url text)
      WHERE c.id = u.id
    `;
  }
  // Mark the misses as probed too, so the next batch moves on instead of
  // retrying the same companies forever.
  const missed = results.filter((r) => r && !r.hit).map((r) => r.id);
  if (missed.length) {
    await sql`
      UPDATE companies SET probed_at = now()
      WHERE id = ANY(${missed}::int[])
    `;
  }

  const [{ remaining }] = await sql`
    SELECT COUNT(*)::int AS remaining FROM companies
    WHERE active = true AND ats IS NULL
      AND (probed_at IS NULL OR probed_at < now() - ${`${PROBE_STALE_DAYS} days`}::interval)
  `;
  return {
    probed: candidates.length,
    found: found.length,
    remaining,
    results: found.map((r) => ({ name: r.name, ats: r.hit.ats, token: r.hit.token, roles: r.hit.count })),
  };
}

// Boards checked within this window are skipped, so clicking "check" twice in a
// row costs nothing and reports "already up to date" instead of silently
// re-reading the same 40 boards.
const FRESH_WINDOW = "6 hours";

// How many role URLs to keep as the "what did this board look like last time"
// baseline. Set well above any real board (the largest here is ~550) so the
// truncation guard below effectively never fires.
const URL_CAP = 2000;

async function refresh(limit) {
  const targets = await sql`
    SELECT id, name, ats, ats_token, last_role_urls FROM companies
    WHERE active = true AND ats IS NOT NULL AND ats_token IS NOT NULL
      AND (checked_at IS NULL OR checked_at < now() - ${FRESH_WINDOW}::interval)
    ORDER BY checked_at NULLS FIRST, id
    LIMIT ${limit}
  `;
  if (!targets.length) return { checked: 0, newRoles: 0, openRoles: 0, remaining: 0, upToDate: true };

  const updates = await pool(targets, 8, async (c) => {
    const jobs = await readBoard(c.ats, c.ats_token);
    const urls = jobs.map((j) => j.url);
    const before = new Set(Array.isArray(c.last_role_urls) ? c.last_role_urls : []);
    // Two cases where a diff would be meaningless rather than merely imprecise:
    // the first check (no baseline — every role would read as new), and a
    // baseline that hit the storage cap (the roles beyond it were never
    // recorded, so they'd be miscounted as new on every single check).
    const blind = before.size === 0 || before.size >= URL_CAP;
    const fresh = blind ? 0 : urls.filter((u) => !before.has(u)).length;
    return {
      id: c.id,
      open_roles: jobs.length,
      new_roles: fresh,
      last_role_urls: urls.slice(0, URL_CAP),
    };
  });

  const payload = updates.filter(Boolean);
  if (payload.length) {
    await sql`
      UPDATE companies c SET
        open_roles = u.open_roles,
        new_roles  = c.new_roles + u.new_roles,
        last_role_urls = u.last_role_urls,
        checked_at = now(), updated_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
        AS u(id int, open_roles int, new_roles int, last_role_urls jsonb)
      WHERE c.id = u.id
    `;
  }

  const [{ remaining }] = await sql`
    SELECT COUNT(*)::int AS remaining FROM companies
    WHERE active = true AND ats IS NOT NULL
      AND (checked_at IS NULL OR checked_at < now() - ${FRESH_WINDOW}::interval)
  `;
  return {
    checked: payload.length,
    newRoles: payload.reduce((s, u) => s + u.new_roles, 0),
    openRoles: payload.reduce((s, u) => s + u.open_roles, 0),
    remaining,
  };
}

export async function POST(request) {
  const s = await getSession();
  if (!s) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  await ensureSchema();

  const body = await request.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit) || 0, 1), 60);

  try {
    switch (body.action) {
      case "seed":
        return Response.json({ ok: true, action: "seed", ...(await seed()) });
      case "probe":
        return Response.json({ ok: true, action: "probe", ...(await probe(body.limit ? limit : 10)) });
      case "refresh":
        return Response.json({ ok: true, action: "refresh", ...(await refresh(body.limit ? limit : 40)) });
      default:
        return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
