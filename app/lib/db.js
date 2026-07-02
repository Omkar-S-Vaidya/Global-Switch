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
    })().catch((e) => {
      ready = null; // allow a retry on next request if the first attempt failed
      throw e;
    });
  }
  return ready;
}
