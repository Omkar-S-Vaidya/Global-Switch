// Neon Postgres access. Uses the serverless HTTP driver (no pooling needed) so
// it works fine inside Next.js route handlers. `sql` is a tagged-template that
// returns rows; parameters are sent safely (no string interpolation).
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — add it to .env");
}

export const sql = neon(process.env.DATABASE_URL);

// Create tables on first use. Cheap (IF NOT EXISTS) and guarded so it only runs
// once per server process.
let ready = null;
export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id            SERIAL PRIMARY KEY,
          email         TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          name          TEXT,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS profiles (
          user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          current_salary  TEXT,
          expected_salary TEXT,
          job_preference  TEXT,
          skills          JSONB NOT NULL DEFAULT '[]'::jsonb,
          resume_name     TEXT,
          resume_type     TEXT,
          resume_text     TEXT,
          resume_b64      TEXT,
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Pristine copy of the uploaded resume, so "add skills to my résumé" always
      // regenerates the updated PDF from the original (no accumulating pages).
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS resume_orig_b64 TEXT`;
      // Edited résumé as HTML — the source of truth for the in-browser editor so
      // it can be re-opened and re-edited (the served PDF is generated from it).
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS resume_html TEXT`;
      // Structured résumé content for the styled template editor (name, title,
      // summary, contact, section HTML, accent/heading colours, photo dataURL).
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS resume_data JSONB`;
      // Persistent cache for rate-limited job sources (e.g. Jooble's 500/day cap),
      // so serverless cold starts reuse recent results instead of re-hitting the API.
      await sql`
        CREATE TABLE IF NOT EXISTS source_cache (
          source     TEXT NOT NULL,
          country    TEXT NOT NULL,
          payload    JSONB NOT NULL DEFAULT '[]'::jsonb,
          fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (source, country)
        )
      `;
      // Per-user application tracking, keyed by a job key (company name) so the
      // status/notes follow a company across the home board and the profile feed.
      await sql`
        CREATE TABLE IF NOT EXISTS job_tracker (
          user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          job_key        TEXT NOT NULL,
          status         TEXT NOT NULL DEFAULT 'none',
          notes          TEXT NOT NULL DEFAULT '',
          resume_version TEXT NOT NULL DEFAULT '',
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, job_key)
        )
      `;

      // ---- Company database -------------------------------------------------
      // The "build the list once, check it daily" master list. Shared across
      // users (it's public company data); per-user state lives in applications.
      // `ats`/`ats_token` are only ever written after a probe confirms the board
      // returns real jobs, so a token here means live openings are available.
      await sql`
        CREATE TABLE IF NOT EXISTS companies (
          id              SERIAL PRIMARY KEY,
          slug            TEXT UNIQUE NOT NULL,
          name            TEXT NOT NULL,
          site            TEXT,
          bucket          TEXT NOT NULL,
          country         TEXT,
          sector          TEXT,
          tier            TEXT NOT NULL DEFAULT 'growing-mnc',
          ats             TEXT,
          ats_token       TEXT,
          careers_url     TEXT,
          linkedin_url    TEXT,
          visa            TEXT NOT NULL DEFAULT 'unknown',
          remote          TEXT NOT NULL DEFAULT 'unknown',
          size            TEXT,
          notes           TEXT NOT NULL DEFAULT '',
          open_roles      INTEGER NOT NULL DEFAULT 0,
          last_role_urls  JSONB NOT NULL DEFAULT '[]'::jsonb,
          new_roles       INTEGER NOT NULL DEFAULT 0,
          checked_at      TIMESTAMPTZ,
          probed_at       TIMESTAMPTZ,
          active          BOOLEAN NOT NULL DEFAULT true,
          added_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS companies_bucket_idx ON companies (bucket)`;
      await sql`CREATE INDEX IF NOT EXISTS companies_ats_idx ON companies (ats) WHERE ats IS NOT NULL`;

      // ---- Applications -----------------------------------------------------
      // One row per application (not per company) so the same employer can be
      // applied to repeatedly, each with its own follow-up date and stage. This
      // is what the daily quota counts and what the follow-up queue reads.
      await sql`
        CREATE TABLE IF NOT EXISTS applications (
          id             SERIAL PRIMARY KEY,
          user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          company_id     INTEGER REFERENCES companies(id) ON DELETE SET NULL,
          company_name   TEXT NOT NULL,
          bucket         TEXT NOT NULL DEFAULT 'remote',
          role_title     TEXT NOT NULL DEFAULT '',
          role_url       TEXT NOT NULL DEFAULT '',
          status         TEXT NOT NULL DEFAULT 'applied',
          applied_on     DATE,
          follow_up_on   DATE,
          source         TEXT NOT NULL DEFAULT '',
          resume_version TEXT NOT NULL DEFAULT '',
          notes          TEXT NOT NULL DEFAULT '',
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS applications_user_idx ON applications (user_id, applied_on DESC)`;
      await sql`
        CREATE INDEX IF NOT EXISTS applications_followup_idx
        ON applications (user_id, follow_up_on) WHERE follow_up_on IS NOT NULL
      `;
      // One application per (user, company, role URL) — re-marking the same role
      // updates rather than duplicating, which would inflate the daily count.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS applications_unique_role
        ON applications (user_id, company_name, role_url)
      `;

      // ---- Per-user settings -------------------------------------------------
      // Daily application targets per bucket, e.g. { remote: 15, india: 10, … }.
      await sql`
        CREATE TABLE IF NOT EXISTS user_settings (
          user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          targets    JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
    })().catch((e) => {
      ready = null; // allow a retry on next request if the first attempt failed
      throw e;
    });
  }
  return ready;
}
