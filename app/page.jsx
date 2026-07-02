"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Nav from "./components/Nav";
import { fetchMe } from "./lib/client";
import { extractSkills, skillLabel } from "./lib/skills";
import { parseResumeFile } from "./lib/parseResume";
import { STATUSES, STATUS_LABEL as LABEL, EMPTY_ENTRY, loadTracker, saveTracker } from "./lib/tracker";

const PAGE_SIZE = 20;

function loadJSON(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

// First letter for the company monogram avatar.
function initial(name = "") {
  return (name.trim()[0] || "?").toUpperCase();
}
// Deterministic soft colour per company so each avatar is distinct but on-theme.
function monoStyle(name = "") {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return { background: `hsl(${h} 70% 94%)`, color: `hsl(${h} 52% 38%)` };
}

export default function Page() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tracker, setTracker] = useState({});
  const [tab, setTab] = useState(null);
  const [page, setPage] = useState(1);
  const [hiringOnly, setHiringOnly] = useState(false);
  const [country, setCountry] = useState("singapore");
  const [expFilter, setExpFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  // Resume matching
  const [resumeSkills, setResumeSkills] = useState([]);
  const [resumeName, setResumeName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [pasteText, setPasteText] = useState("");
  const [viewMode, setViewMode] = useState("companies"); // companies | matches

  // Gate the page — redirect to /login if there's no session.
  useEffect(() => {
    fetchMe().then((u) => {
      if (!u) router.replace("/login");
      else {
        setUser(u);
        setChecking(false);
      }
    });
  }, [router]);

  useEffect(() => {
    const rs = loadJSON("jobhunt.resumeSkills", []);
    const rn = loadJSON("jobhunt.resumeName", "");
    if (rs.length) {
      setResumeSkills(rs);
      setResumeName(rn);
    }
  }, []);

  // Load the user's saved application tracker from the database.
  useEffect(() => {
    if (!user) return;
    loadTracker().then(setTracker);
  }, [user]);

  const load = useCallback(async (countryKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs?country=${countryKey}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load");
      setData(json);
      setTab((t) => t || json.categories?.[0]?.key);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(country);
  }, [load, country]);

  useEffect(() => {
    setPage(1);
  }, [tab, hiringOnly, expFilter, typeFilter, viewMode, country]);

  // Keep the active tab on one that actually has live openings.
  useEffect(() => {
    if (!data?.counts || !data?.categories) return;
    const hasData = tab && data.counts[tab]?.total > 0;
    if (!hasData) {
      const firstNonEmpty = data.categories.find((c) => data.counts[c.key]?.total > 0);
      if (firstNonEmpty) setTab(firstNonEmpty.key);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtersActive = expFilter !== "all" || typeFilter !== "all";

  const matchRoles = useCallback(
    (roles = []) =>
      roles.filter(
        (r) =>
          (expFilter === "all" || r.exp === expFilter) &&
          (typeFilter === "all" || r.type === typeFilter)
      ),
    [expFilter, typeFilter]
  );

  // Update local state immediately; persist to the DB when `commit` is true
  // (on select change / input blur) to avoid a write on every keystroke.
  const update = (company, patch, commit = false) => {
    setTracker((prev) => ({
      ...prev,
      [company]: { ...(prev[company] || EMPTY_ENTRY), ...patch },
    }));
    if (commit) saveTracker(company, patch);
  };

  // ---- Resume handling ----
  const applyResumeText = useCallback((text, name) => {
    const skills = extractSkills(text || "");
    setResumeSkills(skills);
    setResumeName(name || "Pasted text");
    setParseError(skills.length ? null : "No known skills detected — try pasting more detail.");
    if (skills.length) setViewMode("matches");
    try {
      localStorage.setItem("jobhunt.resumeSkills", JSON.stringify(skills));
      localStorage.setItem("jobhunt.resumeName", JSON.stringify(name || "Pasted text"));
    } catch {}
  }, []);

  const onFile = async (file) => {
    if (!file) return;
    setParsing(true);
    setParseError(null);
    try {
      const text = await parseResumeFile(file);
      applyResumeText(text, file.name);
    } catch (e) {
      setParseError("Couldn't read that file: " + (e?.message || e));
    } finally {
      setParsing(false);
    }
  };

  const clearResume = () => {
    setResumeSkills([]);
    setResumeName("");
    setPasteText("");
    setViewMode("companies");
    try {
      localStorage.removeItem("jobhunt.resumeSkills");
      localStorage.removeItem("jobhunt.resumeName");
    } catch {}
  };

  const hasResume = resumeSkills.length > 0;
  const resumeSet = useMemo(() => new Set(resumeSkills), [resumeSkills]);

  // Add skills the resume is missing (e.g. from a job's requirements) to the
  // detected skill set so future matches improve.
  const addResumeSkills = useCallback((toAdd) => {
    setResumeSkills((prev) => {
      const merged = Array.from(new Set([...prev, ...toAdd]));
      try {
        localStorage.setItem("jobhunt.resumeSkills", JSON.stringify(merged));
      } catch {}
      return merged;
    });
  }, []);

  // ---- Companies view ----
  const tabCompanies = useMemo(() => {
    const all = data?.companies || [];
    let list = all
      .filter((c) => c.category === tab)
      .map((c) => {
        const fr = matchRoles(c.roles);
        return {
          ...c,
          visRoles: fr.length,
          visRole: fr[0]?.title || c.role,
          visApplyUrl: fr[0]?.url || c.platformUrl,
        };
      });
    if (filtersActive) list = list.filter((c) => c.visRoles > 0);
    else if (hiringOnly) list = list.filter((c) => c.openRoles > 0);
    return list.sort((a, b) => {
      const av = filtersActive ? a.visRoles : a.openRoles || 0;
      const bv = filtersActive ? b.visRoles : b.openRoles || 0;
      if (bv !== av) return bv - av;
      return a.company.localeCompare(b.company);
    });
  }, [data, tab, hiringOnly, filtersActive, matchRoles]);

  // ---- Resume matches view (all live roles in country, ranked by skill overlap) ----
  const matchedRoles = useMemo(() => {
    if (!hasResume || !data?.companies) return [];
    const out = [];
    for (const c of data.companies) {
      for (const r of matchRoles(c.roles || [])) {
        const matched = (r.skills || []).filter((s) => resumeSet.has(s));
        if (!matched.length) continue;
        const missing = (r.skills || []).filter((s) => !resumeSet.has(s));
        const reqPct = r.skills.length
          ? Math.round((matched.length / r.skills.length) * 100)
          : 0;
        out.push({
          company: c.company,
          sector: c.sector,
          category: c.category,
          title: r.title,
          url: r.url,
          location: r.location,
          exp: r.exp,
          type: r.type,
          score: matched.length,
          reqPct,
          matched,
          missing,
          updatedAt: r.updatedAt,
        });
      }
    }
    out.sort((a, b) => b.score - a.score || b.reqPct - a.reqPct);
    return out;
  }, [hasResume, data, matchRoles, resumeSet]);

  const inMatches = viewMode === "matches" && hasResume;
  const listLength = inMatches ? matchedRoles.length : tabCompanies.length;
  const totalPages = Math.max(1, Math.ceil(listLength / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const pageCompanies = tabCompanies.slice(start, start + PAGE_SIZE);
  const pageMatches = matchedRoles.slice(start, start + PAGE_SIZE);

  const appliedCount = useMemo(
    () => Object.values(tracker).filter((t) => t.status === "applied").length,
    [tracker]
  );

  const today = new Date().toLocaleDateString("en-SG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (checking) return <div className="authshell"><div className="spinner" /></div>;

  return (
    <>
      <Nav user={user} />
      <div className="wrap">
      <header className="top">
        <div>
          <h1>🎯 Job Hunt Command Center</h1>
          <p className="sub">Live software roles by country, tier &amp; resume fit — {today}</p>
        </div>
        <div className="stats">
          <div className="stat">
            <b style={{ color: "var(--green)" }}>{appliedCount}</b>
            <span>Applied</span>
          </div>
          <div className="stat">
            <b style={{ color: "var(--accent)" }}>{data?.liveCount ?? "–"}</b>
            <span>Hiring now</span>
          </div>
          <div className="stat">
            <b style={{ color: "var(--accent)" }}>{data?.totalOpenRoles ?? "–"}</b>
            <span>Open roles</span>
          </div>
        </div>
      </header>

      {data?.countries && (
        <div className="countries">
          {data.countries.map((c) => (
            <button
              key={c.key}
              className={`country ${country === c.key ? "active" : ""}`}
              onClick={() => {
                setCountry(c.key);
                setTab(null);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Resume panel */}
      <div className="resume">
        <div className="resumeHead">
          <span>📄 Resume match</span>
          {hasResume && (
            <span className="resumeMeta">
              {resumeName} · <b>{resumeSkills.length} skills</b>
            </span>
          )}
        </div>
        <div className="resumeBody">
          <label className="filelabel">
            {parsing ? "Parsing…" : "Upload PDF / DOCX"}
            <input
              type="file"
              accept=".pdf,.docx,.txt"
              hidden
              disabled={parsing}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          <span className="or">or paste</span>
          <input
            className="paste"
            placeholder="Paste resume text, then press Enter…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyResumeText(pasteText, "Pasted text");
            }}
          />
          {hasResume && (
            <button className="btn ghost" onClick={clearResume}>
              Clear
            </button>
          )}
        </div>
        {parseError && <p className="resumeErr">{parseError}</p>}
        {hasResume && (
          <div className="skillchips">
            {resumeSkills.map((s) => (
              <span key={s} className="chip">
                {skillLabel(s)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* View toggle (only with a resume) */}
      {hasResume && (
        <div className="viewtoggle">
          <button
            className={viewMode === "companies" ? "active" : ""}
            onClick={() => setViewMode("companies")}
          >
            🏢 By company
          </button>
          <button
            className={viewMode === "matches" ? "active" : ""}
            onClick={() => setViewMode("matches")}
          >
            🎯 Best matches ({matchedRoles.length})
          </button>
        </div>
      )}

      {/* Tier tabs (company view only) */}
      {!inMatches && data?.categories && (
        <div className="tabs">
          {data.categories.map((c) => {
            const cnt = data.counts?.[c.key] || { total: 0 };
            const empty = cnt.total === 0;
            return (
              <button
                key={c.key}
                className={`tab ${tab === c.key ? "active" : ""} ${empty ? "isempty" : ""}`}
                disabled={empty}
                title={empty ? "No live openings here right now" : undefined}
                onClick={() => !empty && setTab(c.key)}
              >
                {c.label}
                <span className="tabcount">{cnt.total}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="toolbar">
        <button className="btn" onClick={() => load(country)} disabled={loading}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
        <select className="filter" value={expFilter} onChange={(e) => setExpFilter(e.target.value)}>
          <option value="all">Any experience</option>
          <option value="intern">Intern / Grad</option>
          <option value="junior">Junior / Associate</option>
          <option value="mid">Mid-level</option>
          <option value="senior">Senior</option>
          <option value="lead">Lead / Staff / Principal</option>
        </select>
        <select className="filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">Any job type</option>
          <option value="fulltime">Full-time</option>
          <option value="contract">Contract</option>
          <option value="internship">Internship</option>
          <option value="parttime">Part-time</option>
        </select>
        <select className="filter" disabled title="Greenhouse boards don't expose salary data">
          <option>💰 Salary (n/a)</option>
        </select>
        {filtersActive && (
          <button
            className="btn ghost"
            onClick={() => {
              setExpFilter("all");
              setTypeFilter("all");
            }}
          >
            Clear filters
          </button>
        )}
        {data?.source && <span className="sub">{data.source}</span>}
      </div>

      {loading && <div className="loading">Fetching live roles…</div>}
      {error && (
        <div className="error">
          Couldn’t load jobs: {error}
          <br />
          <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => load(country)}>
            Try again
          </button>
        </div>
      )}

      {/* ---------- Resume matches view ---------- */}
      {!loading && !error && inMatches && (
        <>
          <div className="grid">
            {pageMatches.map((m, i) => {
              const t = tracker[m.company] || { status: "none", notes: "", resume: "" };
              const rank = start + i + 1;
              return (
                <div key={m.company + m.title + i} className={`card ${t.status}`}>
                  <div className="cardtop">
                    <div className="cardhead">
                      <span className="mono" style={monoStyle(m.company)}>{initial(m.company)}</span>
                      <div className="cardheadtext">
                        <p className="co">
                          {m.company}
                          <span className="matchpct">🎯 {m.score} skill match · {m.reqPct}% fit</span>
                        </p>
                        <p className="role">{m.title}</p>
                        <p className="loc">
                          📍 {m.location} · {m.sector} · {m.exp} · {m.type}
                        </p>
                      </div>
                    </div>
                    <span className={`pill ${t.status}`}>{LABEL[t.status]}</span>
                  </div>
                  <div className="skillchips small">
                    {m.matched.map((s) => (
                      <span key={s} className="chip on">
                        ✓ {skillLabel(s)}
                      </span>
                    ))}
                  </div>
                  {m.missing?.length > 0 && (
                    <div className="gaprow">
                      <span className="gaplabel">Missing ({m.missing.length}) · tap to add:</span>
                      <div className="skillchips small">
                        {m.missing.map((s) => (
                          <button
                            key={s}
                            className="chip miss"
                            title="Add this skill to your resume skills"
                            onClick={() => addResumeSkills([s])}
                          >
                            + {skillLabel(s)}
                          </button>
                        ))}
                      </div>
                      {m.missing.length > 1 && (
                        <button className="addskills" onClick={() => addResumeSkills(m.missing)}>
                          ➕ Add all {m.missing.length} to my resume skills
                        </button>
                      )}
                    </div>
                  )}
                  <div className="links">
                    <a className="lnk pl" href={m.url} target="_blank" rel="noreferrer">
                      🚀 Apply (open role)
                    </a>
                    <a
                      className="lnk li"
                      href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(
                        m.company + " " + m.title
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      in LinkedIn
                    </a>
                  </div>
                  <div className="statusRow">
                    <select
                      value={t.status}
                      onChange={(e) => update(m.company, { status: e.target.value }, true)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <input
                      className="notes"
                      placeholder="Notes…"
                      value={t.notes}
                      onChange={(e) => update(m.company, { notes: e.target.value })}
                      onBlur={(e) => saveTracker(m.company, { notes: e.target.value })}
                    />
                  </div>
                </div>
              );
            })}
            {pageMatches.length === 0 && (
              <div className="empty">
                No live roles match your resume skills in this country/filters yet.
              </div>
            )}
          </div>
        </>
      )}

      {/* ---------- Companies view ---------- */}
      {!loading && !error && !inMatches && (
        <div className="grid">
          {pageCompanies.map((co, i) => {
            const t = tracker[co.company] || { status: "none", notes: "", resume: "" };
            const rank = start + i + 1;
            const shownCount = filtersActive ? co.visRoles : co.openRoles;
            const shownRole = filtersActive ? co.visRole : co.role;
            const applyUrl = filtersActive ? co.visApplyUrl : co.platformUrl;
            return (
              <div key={co.company} className={`card ${t.status}`}>
                <div className="cardtop">
                  <div className="cardhead">
                    <span className="mono" style={monoStyle(co.company)}>{initial(co.company)}</span>
                    <div className="cardheadtext">
                      <p className="co">
                        {co.company}
                        {shownCount > 0 && (
                          <span className="hot">
                            🔥 {shownCount}
                            {filtersActive ? " matching" : ""} role{shownCount > 1 ? "s" : ""}
                          </span>
                        )}
                      </p>
                      <p className="role">{shownRole}</p>
                      <p className="loc">
                        📍 {co.location} · {co.sector}
                        {co.platform && co.live && <> · via {co.platform}</>}
                        {!co.live && (
                          <> · <span style={{ color: "var(--muted)" }}>search openings</span></>
                        )}
                      </p>
                    </div>
                  </div>
                  <span className={`pill ${t.status}`}>{LABEL[t.status]}</span>
                </div>

                <div className="links">
                  <a className="lnk pl" href={applyUrl} target="_blank" rel="noreferrer">
                    🚀 {co.live ? "Apply (open role)" : "Find roles"}
                  </a>
                  {co.live && co.boardUrl && (
                    <a className="lnk pl2" href={co.boardUrl} target="_blank" rel="noreferrer">
                      📋 All roles
                    </a>
                  )}
                  <a className="lnk li" href={co.linkedinUrl} target="_blank" rel="noreferrer">
                    in LinkedIn
                  </a>
                  <a className="lnk ca" href={co.careersUrl} target="_blank" rel="noreferrer">
                    🏢 Careers
                  </a>
                </div>

                <div className="statusRow">
                  <select
                    value={t.status}
                    onChange={(e) => update(co.company, { status: e.target.value }, true)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Resume version"
                    value={t.resume}
                    onChange={(e) => update(co.company, { resume: e.target.value })}
                    onBlur={(e) => saveTracker(co.company, { resume: e.target.value })}
                    style={{ width: 160 }}
                  />
                  <input
                    className="notes"
                    placeholder="Notes (recruiter, referral, follow-up…)"
                    value={t.notes}
                    onChange={(e) => update(co.company, { notes: e.target.value })}
                    onBlur={(e) => saveTracker(co.company, { notes: e.target.value })}
                  />
                </div>
              </div>
            );
          })}
          {pageCompanies.length === 0 && (
            <div className="empty">
              {filtersActive
                ? "No live roles match these filters here — clear filters or try another tab/country."
                : "No live openings in this tier right now — try another tab or country."}
            </div>
          )}
        </div>
      )}

      {!loading && !error && totalPages > 1 && (
        <div className="pager">
          <button className="btn ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ‹ Prev
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => Math.abs(p - page) < 4 || p === 1 || p === totalPages)
            .map((p, idx, arr) => (
              <span key={p} style={{ display: "inline-flex" }}>
                {idx > 0 && p - arr[idx - 1] > 1 && <span className="dots">…</span>}
                <button
                  className={`pagebtn ${p === page ? "active" : ""}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              </span>
            ))}
          <button
            className="btn ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next ›
          </button>
        </div>
      )}

      <footer className="foot">
        Discovery is automated; the final “Apply” click is yours. Live roles come from
        companies’ public Greenhouse boards. Your resume is parsed in-browser and never
        uploaded — only the detected skills are used for matching.
      </footer>
      </div>
    </>
  );
}
