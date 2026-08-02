"use client";

// The company database — build the list once, then check it every day.
//
// Three maintenance actions drive it, each a chunked loop so a big database
// never blocks on one request:
//   Seed   — load the bundled list of ~250 companies across the five buckets
//   Probe  — ask each ATS whether a company has a board, and save what answers
//   Check  — re-read every known board and flag what's new since last time
//
// After the first probe, most rows stop being "a careers page to remember" and
// become a live opening count with a NEW badge.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Nav from "../components/Nav";
import { fetchMe } from "../lib/client";
import { BUCKETS, VISA_OPTIONS, REMOTE_OPTIONS } from "../lib/buckets";
import { todayLocal, addDays, fmtDay, FOLLOW_UP_DAYS } from "../lib/dates";

const PAGE_SIZE = 40;

// Duplicated from lib/ats rather than imported so the server-only board readers
// stay out of the browser bundle.
const ATS_LABEL = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  recruitee: "Recruitee",
  smartrecruiters: "SmartRecruiters",
  workable: "Workable",
  personio: "Personio",
};

const TIERS = [
  ["big-mnc", "Big MNC"],
  ["growing-mnc", "Scale-up"],
  ["startup", "Startup"],
  ["bank-finance", "Bank / Finance"],
  ["gov-local", "Gov / Local"],
];
const TIER_LABEL = Object.fromEntries(TIERS);

function monoStyle(name = "") {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return { background: `hsl(${h} 70% 94%)`, color: `hsl(${h} 52% 38%)` };
}

export default function CompaniesPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");

  const [bucket, setBucket] = useState("");
  const [visa, setVisa] = useState("");
  const [remote, setRemote] = useState("");
  const [q, setQ] = useState("");
  const [hiringOnly, setHiringOnly] = useState(false);
  const [boardOnly, setBoardOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchMe().then((u) => (u ? setUser(u) : router.replace("/login")));
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (bucket) p.set("bucket", bucket);
      if (visa) p.set("visa", visa);
      if (remote) p.set("remote", remote);
      if (q.trim()) p.set("q", q.trim());
      if (hiringOnly) p.set("hiring", "1");
      if (boardOnly) p.set("board", "1");
      const res = await fetch(`/api/companies?${p}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed");
      setRows(json.companies);
      setCounts(json.counts || {});
    } catch (e) {
      toast.error("Couldn't load companies: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [bucket, visa, remote, q, hiringOnly, boardOnly]);

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(load, q ? 300 : 0); // debounce the search box only
    return () => clearTimeout(t);
  }, [user, load, q]);

  useEffect(() => setPage(1), [bucket, visa, remote, q, hiringOnly, boardOnly]);

  const sync = (action, body = {}) =>
    fetch("/api/companies/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    }).then((r) => r.json());

  const onSeed = async () => {
    setBusy("seed");
    setProgress("Loading the bundled company list…");
    try {
      const r = await sync("seed");
      if (!r.ok) throw new Error(r.error);
      toast.success(`${r.total} companies in your database (${r.added} new).`);
      await load();
    } catch (e) {
      toast.error("Seed failed: " + e.message);
    } finally {
      setBusy("");
      setProgress("");
    }
  };

  // Probe and check both loop until the server reports nothing left, so one
  // click finishes the whole database instead of one batch.
  const onProbe = async () => {
    setBusy("probe");
    let found = 0;
    let done = 0;
    try {
      for (let i = 0; i < 60; i++) {
        const r = await sync("probe", { limit: 10 });
        if (!r.ok) throw new Error(r.error);
        found += r.found;
        done += r.probed;
        setProgress(`Probed ${done} companies · ${found} live boards found · ${r.remaining} to go`);
        if (!r.probed || !r.remaining) break;
      }
      toast.success(`Found ${found} live ATS boards.`);
      await load();
    } catch (e) {
      toast.error("Probe failed: " + e.message);
    } finally {
      setBusy("");
      setProgress("");
    }
  };

  const onCheck = async () => {
    setBusy("check");
    let newRoles = 0;
    let checked = 0;
    let upToDate = false;
    try {
      for (let i = 0; i < 40; i++) {
        const r = await sync("refresh", { limit: 40 });
        if (!r.ok) throw new Error(r.error);
        newRoles += r.newRoles;
        checked += r.checked;
        if (i === 0 && r.upToDate) upToDate = true;
        setProgress(`Checked ${checked} boards · ${newRoles} new openings · ${r.remaining} to go`);
        if (!r.checked || !r.remaining) break;
      }
      toast.success(
        upToDate
          ? "Already up to date — every board was checked in the last 6 hours."
          : newRoles
            ? `${newRoles} new openings since your last check.`
            : `Checked ${checked} boards — nothing new yet.`
      );
      await load();
    } catch (e) {
      toast.error("Check failed: " + e.message);
    } finally {
      setBusy("");
      setProgress("");
    }
  };

  const patch = async (id, body) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...body } : r)));
    await fetch("/api/companies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
  };

  // Log an application straight from the database row — the daily loop is
  // "open the list → apply → record it" and this is the record step.
  const logApplication = async (c) => {
    const today = todayLocal();
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: c.id,
        companyName: c.name,
        bucket: c.bucket,
        roleUrl: "",
        status: "applied",
        appliedOn: today,
        followUpOn: addDays(today, FOLLOW_UP_DAYS),
        source: "Company database",
      }),
    });
    const json = await res.json();
    if (json.ok) toast.success(`Logged — follow up on ${fmtDay(addDays(today, FOLLOW_UP_DAYS))}`);
    else toast.error("Couldn't log that application.");
  };

  const onAdd = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries(f.entries());
    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.ok) {
      toast.success(`${body.name} added.`);
      setAdding(false);
      load();
    } else toast.error(json.error || "Couldn't add that company.");
  };

  const totals = useMemo(() => {
    const all = Object.values(counts);
    return {
      total: all.reduce((s, c) => s + c.total, 0),
      withBoard: all.reduce((s, c) => s + c.with_board, 0),
      openRoles: all.reduce((s, c) => s + c.open_roles, 0),
      newRoles: all.reduce((s, c) => s + c.new_roles, 0),
    };
  }, [counts]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filtersOn = bucket || visa || remote || q || hiringOnly || boardOnly;

  if (!user) return <div className="loading">Loading…</div>;

  return (
    <>
      <Nav user={user} />
      <main className="wrap">
        <header className="pagehead">
          <div>
            <h1>🗂️ Company database</h1>
            <p className="sub">
              Build the list once, then check it every day. Companies with a live board report
              their own openings — no careers page to remember.
            </p>
          </div>
          <div className="stats">
            <div className="stat">
              <b>{totals.total}</b>
              <span>companies</span>
            </div>
            <div className="stat">
              <b>{totals.withBoard}</b>
              <span>live boards</span>
            </div>
            <div className="stat">
              <b>{totals.openRoles}</b>
              <span>open roles</span>
            </div>
            <div className="stat">
              <b className={totals.newRoles ? "hot" : ""}>{totals.newRoles}</b>
              <span>new</span>
            </div>
          </div>
        </header>

        <div className="syncbar">
          <button className="btn" onClick={onSeed} disabled={!!busy}>
            {busy === "seed" ? "Loading…" : "⬇ Load starter list"}
          </button>
          <button className="btn" onClick={onProbe} disabled={!!busy || !totals.total}>
            {busy === "probe" ? "Probing…" : "🔎 Find ATS boards"}
          </button>
          <button className="btn primary" onClick={onCheck} disabled={!!busy || !totals.withBoard}>
            {busy === "check" ? "Checking…" : "↻ Check for new openings"}
          </button>
          <button className="btn ghost" onClick={() => setAdding((v) => !v)} disabled={!!busy}>
            {adding ? "Cancel" : "+ Add company"}
          </button>
          {progress && <span className="syncprogress">{progress}</span>}
        </div>

        {adding && (
          <form className="addform" onSubmit={onAdd}>
            <input name="name" placeholder="Company name" required />
            <input name="site" placeholder="domain.com" />
            <input name="sector" placeholder="Sector (e.g. Fintech)" />
            <select name="bucket" defaultValue="remote">
              {BUCKETS.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </select>
            <select name="tier" defaultValue="growing-mnc">
              {TIERS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <select name="visa" defaultValue="unknown">
              {VISA_OPTIONS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </select>
            <select name="remote" defaultValue="unknown">
              {REMOTE_OPTIONS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </select>
            <input name="careersUrl" placeholder="Careers page URL (optional)" />
            <button className="btn primary" type="submit">
              Add
            </button>
          </form>
        )}

        <div className="countries">
          <button className={`country ${!bucket ? "active" : ""}`} onClick={() => setBucket("")}>
            All <span className="tabcount">{totals.total}</span>
          </button>
          {BUCKETS.map((b) => {
            const c = counts[b.key] || {};
            return (
              <button
                key={b.key}
                className={`country ${bucket === b.key ? "active" : ""}`}
                onClick={() => setBucket(b.key)}
                title={`${c.with_board || 0} live boards · ${c.open_roles || 0} open roles`}
              >
                {b.label} <span className="tabcount">{c.total || 0}</span>
                {c.new_roles > 0 && <span className="newdot">{c.new_roles}</span>}
              </button>
            );
          })}
        </div>

        <div className="toolbar">
          <input
            className="paste"
            placeholder="Search company or sector…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="filter" value={visa} onChange={(e) => setVisa(e.target.value)}>
            <option value="">Any sponsorship</option>
            {VISA_OPTIONS.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
          <select className="filter" value={remote} onChange={(e) => setRemote(e.target.value)}>
            <option value="">Any work mode</option>
            {REMOTE_OPTIONS.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
          <label className="checkfilter">
            <input
              type="checkbox"
              checked={hiringOnly}
              onChange={(e) => setHiringOnly(e.target.checked)}
            />
            Hiring now
          </label>
          <label className="checkfilter">
            <input
              type="checkbox"
              checked={boardOnly}
              onChange={(e) => setBoardOnly(e.target.checked)}
            />
            Live board only
          </label>
          {filtersOn && (
            <button
              className="btn ghost"
              onClick={() => {
                setBucket("");
                setVisa("");
                setRemote("");
                setQ("");
                setHiringOnly(false);
                setBoardOnly(false);
              }}
            >
              Clear
            </button>
          )}
          <span className="sub">{rows.length} shown</span>
        </div>

        {loading && <div className="loading">Loading companies…</div>}

        {!loading && !rows.length && (
          <div className="empty">
            {totals.total === 0 ? (
              <>
                Your database is empty. Hit <b>Load starter list</b> to bring in ~250 companies
                across Remote, Netherlands, Germany, the UK and India — then <b>Find ATS boards</b>{" "}
                to make them self-reporting.
              </>
            ) : (
              <>No companies match those filters.</>
            )}
          </div>
        )}

        <div className="colist">
          {shown.map((c) => (
            <div key={c.id} className={`corow ${c.newRoles > 0 ? "isnew" : ""}`}>
              <span className="mono" style={monoStyle(c.name)}>
                {(c.name[0] || "?").toUpperCase()}
              </span>

              <div className="coinfo">
                <p className="co">
                  {c.name}
                  {c.newRoles > 0 && <span className="newbadge">{c.newRoles} new</span>}
                </p>
                <p className="small muted">
                  {[c.sector, TIER_LABEL[c.tier], c.site].filter(Boolean).join(" · ")}
                </p>
              </div>

              <div className="cometa">
                {c.ats ? (
                  <span className="pill live" title={`Board checked ${fmtDay(c.checkedAt)}`}>
                    {ATS_LABEL[c.ats] || c.ats} · {c.openRoles} open
                  </span>
                ) : (
                  <span className="pill dim" title="No ATS board found yet — check the careers page by hand">
                    careers page
                  </span>
                )}
                <select
                  className="minisel"
                  value={c.visa}
                  onChange={(e) => patch(c.id, { visa: e.target.value })}
                  title="Visa sponsorship"
                >
                  {VISA_OPTIONS.map((v) => (
                    <option key={v.key} value={v.key}>
                      {v.label}
                    </option>
                  ))}
                  <option value="n/a">n/a</option>
                </select>
                <select
                  className="minisel"
                  value={c.remote}
                  onChange={(e) => patch(c.id, { remote: e.target.value })}
                  title="Work mode"
                >
                  {REMOTE_OPTIONS.map((v) => (
                    <option key={v.key} value={v.key}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="colinks">
                {c.careersUrl && (
                  <a className="viewlink careers" href={c.careersUrl} target="_blank" rel="noreferrer">
                    Careers
                  </a>
                )}
                <a className="viewlink linkedin" href={c.linkedinUrl} target="_blank" rel="noreferrer">
                  LinkedIn
                </a>
                <button
                  className="viewlink applied"
                  onClick={() => {
                    logApplication(c);
                    if (c.newRoles) patch(c.id, { clearNew: true, newRoles: 0 });
                  }}
                >
                  ✓ Applied
                </button>
              </div>
            </div>
          ))}
        </div>

        {pages > 1 && (
          <div className="pager">
            <button className="pagebtn" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </button>
            <span className="small muted">
              Page {page} of {pages}
            </span>
            <button
              className="pagebtn"
              disabled={page === pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </main>
    </>
  );
}
