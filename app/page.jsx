"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Nav from "./components/Nav";
import ApplyTime from "./components/ApplyTime";
import { fetchMe } from "./lib/client";
import { extractSkills, skillLabel } from "./lib/skills";
import { parseResumeFile } from "./lib/parseResume";
import { STATUSES, STATUS_LABEL as LABEL, EMPTY_ENTRY, loadTracker, saveTracker } from "./lib/tracker";
import { BUCKET_KEYS } from "./lib/buckets";
import { todayLocal, addDays, FOLLOW_UP_DAYS } from "./lib/dates";
import { YEAR_FILTERS, matchesYears } from "./lib/experience";

const PAGE_SIZE = 20;

// A collapsible job description. Shared by both views so the matches list and
// the company role rows can't drift apart.
//
// Descriptions run to several thousand characters; dumping one in full pushes
// the next role off the screen. It opens clamped to a readable preview with a
// fade, and "Show full description" lifts the clamp.
function Description({ url, hasDesc, platform, state, onToggle }) {
  const [full, setFull] = useState(false);
  const open = state !== undefined;
  const text = state;

  if (!hasDesc) {
    return (
      <p className="small muted nodesc">
        No description from {platform || "this source"} — open the posting to read it.
      </p>
    );
  }

  return (
    <div className="descblock">
      <button className="descbtn" onClick={() => onToggle(url)} aria-expanded={open}>
        {open ? "▾" : "▸"} Job description
      </button>
      {open && (
        <>
          <div className={`desctext ${full ? "" : "clamped"}`}>
            {text === null ? "Loading…" : text}
          </div>
          {text && text.length > 400 && (
            <button className="descmore" onClick={() => setFull((v) => !v)}>
              {full ? "Show less ↑" : "Show full description ↓"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// "3d ago" / "2mo ago" — how stale a posting is, at a glance.
function postedAgo(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// Salary is published by only a minority of boards (UK aggregators mostly), so
// this renders a badge when it exists rather than pretending it's a filterable
// field everywhere.
function salaryLabel(min, max) {
  if (min == null && max == null) return null;
  const k = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  if (min != null && max != null) return `${k(min)}–${k(max)}`;
  return k(min ?? max);
}

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
  const [country, setCountry] = useState("remote");
  const [expFilter, setExpFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  // Freshness is the highest-value filter here: the median posting is ~11 days
  // old and the oldest is over a year, so undated/stale roles waste applications.
  const [postedFilter, setPostedFilter] = useState("all");
  const [visaFilter, setVisaFilter] = useState("all");
  const [minMatch, setMinMatch] = useState(0);
  const [hideApplied, setHideApplied] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [yearsFilter, setYearsFilter] = useState("all");
  // Fetched one at a time from /api/jobs/detail; null = loading, "" = no text.
  const [openDesc, setOpenDesc] = useState({});
  // Company cards whose full role list is expanded, plus which ones have been
  // "show all"-ed past the initial slice.
  const [openRoles, setOpenRoles] = useState({});
  const [showAllRoles, setShowAllRoles] = useState({});
  // Company names + role URLs already logged in the pipeline, so applied roles
  // can drop out of the list instead of being re-read every morning.
  const [appliedKeys, setAppliedKeys] = useState({ urls: new Set(), companies: new Set() });

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

  // Skills come from the saved profile — one source of truth, shared with the
  // résumé editor and surviving a browser clear. localStorage is only a cache
  // for the pre-login/offline case and is overridden whenever the profile has
  // skills of its own.
  useEffect(() => {
    const rs = loadJSON("jobhunt.resumeSkills", []);
    const rn = loadJSON("jobhunt.resumeName", "");
    if (rs.length) {
      setResumeSkills(rs);
      setResumeName(rn);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch("/api/profile", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const p = j?.profile;
        if (p?.skills?.length) {
          setResumeSkills(p.skills);
          setResumeName(p.resumeName || "Your profile");
        }
      })
      .catch(() => {});
  }, [user]);

  // Load the user's saved application tracker from the database.
  useEffect(() => {
    if (!user) return;
    loadTracker().then(setTracker);
  }, [user]);

  // Pipeline rows drive the "hide already applied" filter.
  const loadApplied = useCallback(async () => {
    try {
      const res = await fetch("/api/applications?limit=500", { cache: "no-store" });
      const j = await res.json();
      const rows = (j.applications || []).filter((a) => a.status !== "saved");
      setAppliedKeys({
        urls: new Set(rows.map((a) => a.role_url).filter(Boolean)),
        companies: new Set(rows.map((a) => a.company_name)),
      });
    } catch {}
  }, []);

  useEffect(() => {
    if (user) loadApplied();
  }, [user, loadApplied]);

  const load = useCallback(async (countryKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs?country=${countryKey}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load");
      setData(json);
      setTab((t) => t || "all");
    } catch (e) {
      setError(e.message);
      toast.error("Couldn't load jobs: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(country);
  }, [load, country]);

  useEffect(() => {
    setPage(1);
  }, [
    tab,
    hiringOnly,
    expFilter,
    typeFilter,
    viewMode,
    country,
    postedFilter,
    visaFilter,
    minMatch,
    hideApplied,
  ]);

  // Keep the active tab on one that actually has live openings. "All" always
  // has data by definition, so it's exempt.
  useEffect(() => {
    if (!data?.counts || !data?.categories || tab === "all") return;
    const hasData = tab && data.counts[tab]?.total > 0;
    if (!hasData) {
      const firstNonEmpty = data.categories.find((c) => data.counts[c.key]?.total > 0);
      if (firstNonEmpty) setTab(firstNonEmpty.key);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtersActive =
    expFilter !== "all" || typeFilter !== "all" || postedFilter !== "all";

  // A role with no posting date can't satisfy a freshness filter, so it is
  // excluded rather than waved through — otherwise "last 7 days" would silently
  // include year-old listings. The count of those is surfaced in the toolbar.
  const matchRoles = useCallback(
    (roles = []) => {
      const cutoff =
        postedFilter === "all" ? null : Date.now() - Number(postedFilter) * 86400000;
      return roles.filter((r) => {
        if (expFilter !== "all" && r.exp !== expFilter) return false;
        if (typeFilter !== "all" && r.type !== typeFilter) return false;
        if (!matchesYears(r.minYears, yearsFilter)) return false;
        if (cutoff !== null) {
          if (!r.updatedAt) return false;
          if (new Date(r.updatedAt).getTime() < cutoff) return false;
        }
        return true;
      });
    },
    [expFilter, typeFilter, postedFilter, yearsFilter]
  );

  // Only 44% of postings state a years requirement, so the filter reports what
  // it couldn't read rather than quietly hiding it.
  const noYearsCount = useMemo(() => {
    if (!data?.companies) return 0;
    let n = 0;
    for (const c of data.companies) for (const r of c.roles || []) if (r.minYears == null) n++;
    return n;
  }, [data]);

  const loadDescription = useCallback(async (url) => {
    setOpenDesc((p) => ({ ...p, [url]: null })); // null renders the spinner
    try {
      const res = await fetch(`/api/jobs/detail?url=${encodeURIComponent(url)}`, {
        cache: "no-store",
      });
      const j = await res.json();
      setOpenDesc((p) => ({ ...p, [url]: j.found ? j.description : (j.reason || "") }));
    } catch {
      setOpenDesc((p) => ({ ...p, [url]: "Couldn't load the description." }));
    }
  }, []);

  const toggleDescription = useCallback(
    (url) => {
      setOpenDesc((p) => {
        if (url in p) {
          const { [url]: _drop, ...rest } = p;
          return rest;
        }
        return p;
      });
      if (!(url in openDesc)) loadDescription(url);
    },
    [openDesc, loadDescription]
  );

  // How many roles the freshness filter is dropping purely for lacking a date —
  // shown so the filter never looks like it found nothing when it just can't tell.
  const undatedCount = useMemo(() => {
    if (postedFilter === "all" || !data?.companies) return 0;
    let n = 0;
    for (const c of data.companies) for (const r of c.roles || []) if (!r.updatedAt) n++;
    return n;
  }, [data, postedFilter]);

  const passesCompanyFilters = useCallback(
    (c) => visaFilter === "all" || c.visa === visaFilter,
    [visaFilter]
  );

  const anyFilterOn =
    filtersActive || visaFilter !== "all" || minMatch > 0 || hideApplied;

  // Shown as a badge on the mobile Filters button so a collapsed panel never
  // hides the fact that something is filtering the results.
  const activeFilterCount = [
    expFilter !== "all",
    typeFilter !== "all",
    postedFilter !== "all",
    visaFilter !== "all",
    minMatch > 0,
    hideApplied,
  ].filter(Boolean).length;

  // Update local state immediately; persist to the DB when `commit` is true
  // (on select change / input blur) to avoid a write on every keystroke.
  //
  // A status change also writes a pipeline row. Without this the board and the
  // quota dashboard disagree: marking something applied here would never count
  // toward the day's target.
  const update = (company, patch, commit = false, ctx = null) => {
    setTracker((prev) => ({
      ...prev,
      [company]: { ...(prev[company] || EMPTY_ENTRY), ...patch },
    }));
    if (!commit) return;
    saveTracker(company, patch);
    if (patch.status && patch.status !== "none") logToPipeline(company, patch.status, ctx);
  };

  const logToPipeline = useCallback(
    async (company, status, ctx) => {
      const today = todayLocal();
      try {
        await fetch("/api/applications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyName: company,
            // "All countries" isn't a bucket, so fall back to the company's own.
            bucket: BUCKET_KEYS.includes(country) ? country : ctx?.bucket || "remote",
            roleTitle: ctx?.title || "",
            roleUrl: ctx?.url || "",
            status,
            appliedOn: today,
            followUpOn: addDays(today, FOLLOW_UP_DAYS),
            source: "Job board",
          }),
        });
        loadApplied();
      } catch {}
    },
    [country, loadApplied]
  );

  // ---- Resume handling ----
  // Skills are mirrored to the profile so the board, the résumé editor and the
  // matcher all read the same set. localStorage stays as a fast local cache.
  const persistSkills = useCallback((skills, name) => {
    try {
      localStorage.setItem("jobhunt.resumeSkills", JSON.stringify(skills));
      if (name) localStorage.setItem("jobhunt.resumeName", JSON.stringify(name));
    } catch {}
    fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skills, resumeName: name || undefined }),
    }).catch(() => {});
  }, []);

  const applyResumeText = useCallback(
    (text, name) => {
      const skills = extractSkills(text || "");
      setResumeSkills(skills);
      setResumeName(name || "Pasted text");
      setParseError(skills.length ? null : "No known skills detected — try pasting more detail.");
      if (skills.length) setViewMode("matches");
      persistSkills(skills, name || "Pasted text");
    },
    [persistSkills]
  );

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
  const addResumeSkills = useCallback(
    (toAdd) => {
      setResumeSkills((prev) => {
        const merged = Array.from(new Set([...prev, ...toAdd]));
        persistSkills(merged);
        return merged;
      });
    },
    [persistSkills]
  );

  // ---- Companies view ----
  const tabCompanies = useMemo(() => {
    const all = data?.companies || [];
    let list = all
      .filter(
        (c) =>
          (tab === "all" || c.category === tab) &&
          passesCompanyFilters(c) &&
          // At company level, "hide applied" hides the employer outright.
          !(hideApplied && appliedKeys.companies.has(c.company))
      )
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
  }, [data, tab, hiringOnly, filtersActive, matchRoles, passesCompanyFilters, hideApplied, appliedKeys]);

  // ---- Resume matches view (all live roles in country, ranked by skill overlap) ----
  const matchedRoles = useMemo(() => {
    if (!hasResume || !data?.companies) return [];
    const out = [];
    for (const c of data.companies) {
      if (!passesCompanyFilters(c)) continue;
      if (tab !== "all" && tab && c.category !== tab) continue;
      for (const r of matchRoles(c.roles || [])) {
        // Matched at role level, not company level — applying to one Adyen role
        // shouldn't hide the other 25.
        if (hideApplied && appliedKeys.urls.has(r.url)) continue;
        const matched = (r.skills || []).filter((s) => resumeSet.has(s));
        if (!matched.length) continue;
        const missing = (r.skills || []).filter((s) => !resumeSet.has(s));
        const reqPct = r.skills.length
          ? Math.round((matched.length / r.skills.length) * 100)
          : 0;
        if (reqPct < minMatch) continue;
        out.push({
          company: c.company,
          sector: c.sector,
          category: c.category,
          visa: c.visa,
          title: r.title,
          url: r.url,
          location: r.location,
          exp: r.exp,
          type: r.type,
          salaryMin: r.salaryMin ?? null,
          salaryMax: r.salaryMax ?? null,
          // These two were missing, so the years badge and the whole
          // description expander evaluated falsy and rendered nothing here.
          minYears: r.minYears ?? null,
          hasDesc: !!r.hasDesc,
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
  }, [
    hasResume,
    data,
    matchRoles,
    resumeSet,
    passesCompanyFilters,
    tab,
    hideApplied,
    appliedKeys,
    minMatch,
  ]);

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
          <span className="seclabel">Resume match</span>
          {hasResume && (
            <span className="resumeMeta">
              {/* The filename truncates and the count doesn't — a long export
                  name like "…_260507_115537 (updated).pdf" otherwise runs over
                  the skill count. */}
              <span className="fname" title={resumeName}>
                {resumeName}
              </span>
              <b className="skillcount">{resumeSkills.length} skills</b>
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
          <div className="skillchips detected">
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

      {/* Tier tabs — "All" first, matching the company database */}
      {data?.categories && (
        <div className="tabs">
          <button
            className={`tab ${tab === "all" ? "active" : ""}`}
            onClick={() => setTab("all")}
          >
            All tiers
            <span className="tabcount">
              {Object.values(data.counts || {}).reduce((s, c) => s + (c.total || 0), 0)}
            </span>
          </button>
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

      <div className={`toolbar collapsible ${filtersOpen ? "open" : ""}`}>
        {/* On mobile every control below collapses behind this button — seven
            stacked full-width selects push the results off the first screen. */}
        <button
          className="filterbtn"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          {filtersOpen ? "Done" : "⚙ Filters"}
          {activeFilterCount > 0 && <span className="count">{activeFilterCount}</span>}
        </button>
        <button
          className="btn alwaysvisible"
          onClick={() => load(country)}
          disabled={loading}
        >
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
        <select
          className="filter"
          value={postedFilter}
          onChange={(e) => setPostedFilter(e.target.value)}
          title="Roles without a posting date are excluded when this is set"
        >
          <option value="all">Any date</option>
          <option value="7">🔥 Posted this week</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
        </select>
        <select className="filter" value={expFilter} onChange={(e) => setExpFilter(e.target.value)}>
          <option value="all">Any experience</option>
          <option value="intern">Intern / Grad</option>
          <option value="junior">Junior / Associate</option>
          <option value="mid">Mid-level</option>
          <option value="senior">Senior</option>
          <option value="lead">Lead / Staff / Principal</option>
          <option value="unknown">Unspecified</option>
        </select>
        <select
          className="filter"
          value={yearsFilter}
          onChange={(e) => setYearsFilter(e.target.value)}
          title="Read from the job description — 44% of postings state one"
        >
          {YEAR_FILTERS.map((y) => (
            <option key={y.key} value={y.key}>
              {y.key === "all" ? y.label : `🎓 ${y.label}`}
            </option>
          ))}
        </select>
        <select className="filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">Any job type</option>
          <option value="fulltime">Full-time</option>
          <option value="contract">Contract</option>
          <option value="internship">Internship</option>
          <option value="parttime">Part-time</option>
        </select>
        <select
          className="filter"
          value={visaFilter}
          onChange={(e) => setVisaFilter(e.target.value)}
          title="Sponsorship likelihood, from your company database"
        >
          <option value="all">Any sponsorship</option>
          <option value="yes">🛂 Sponsors visas</option>
          <option value="likely">Likely sponsors</option>
          <option value="n/a">Remote — n/a</option>
        </select>
        {inMatches && (
          <select
            className="filter"
            value={minMatch}
            onChange={(e) => setMinMatch(Number(e.target.value))}
            title="Minimum share of the role's listed skills that you already have"
          >
            <option value={0}>Any fit</option>
            <option value={25}>🎯 25%+ fit</option>
            <option value={50}>50%+ fit</option>
            <option value={75}>75%+ fit</option>
          </select>
        )}
        <label className="checkfilter">
          <input
            type="checkbox"
            checked={hideApplied}
            onChange={(e) => setHideApplied(e.target.checked)}
          />
          Hide applied
        </label>
        {anyFilterOn && (
          <button
            className="btn ghost"
            onClick={() => {
              setExpFilter("all");
              setTypeFilter("all");
              setPostedFilter("all");
              setVisaFilter("all");
              setMinMatch(0);
              setHideApplied(false);
            }}
          >
            Clear filters
          </button>
        )}
        {undatedCount > 0 && (
          <span className="sub" title="These roles have no posting date, so a date filter can't include them">
            {undatedCount} undated hidden
          </span>
        )}
        {yearsFilter !== "all" && yearsFilter !== "none" && noYearsCount > 0 && (
          <span
            className="sub"
            title="These postings don't state a years requirement, so they can't be matched against one"
          >
            {noYearsCount} state no requirement
          </span>
        )}
        {data?.source && <span className="sub">{data.source}</span>}
      </div>

      <ApplyTime
        country={country}
        countryLabel={data?.countries?.find((c) => c.key === country)?.label}
      />

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
                          {postedAgo(m.updatedAt) && (
                            <>
                              {" · "}
                              <span
                                className={
                                  (Date.now() - new Date(m.updatedAt)) / 86400000 <= 7
                                    ? "freshtag"
                                    : ""
                                }
                              >
                                🕒 {postedAgo(m.updatedAt)}
                              </span>
                            </>
                          )}
                          {salaryLabel(m.salaryMin, m.salaryMax) && (
                            <> · 💰 {salaryLabel(m.salaryMin, m.salaryMax)}</>
                          )}
                          {m.minYears != null && <> · 🎓 {m.minYears}+ yrs</>}
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
                  <Description
                    url={m.url}
                    hasDesc={m.hasDesc}
                    platform={m.platform}
                    state={m.url in openDesc ? openDesc[m.url] : undefined}
                    onToggle={toggleDescription}
                  />

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
                      onChange={(e) =>
                        update(m.company, { status: e.target.value }, true, {
                          title: m.title,
                          url: m.url,
                        })
                      }
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
                <b>No data found.</b>
                <br />No live roles match your resume skills in this country/filters yet.
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
            // Respect the active filters here too, so expanding a card can't
            // reveal roles the filters were meant to exclude.
            const companyRoles = matchRoles(co.roles || []);
            const visibleRoles = showAllRoles[co.company]
              ? companyRoles
              : companyRoles.slice(0, 8);
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

                {/* Every open role, in place. Previously the card showed one
                    role and sent you off-site for the rest — and for any
                    description at all. */}
                {co.live && companyRoles.length > 0 && (
                  <div className="rolelist">
                    <button
                      className="descbtn"
                      onClick={() =>
                        setOpenRoles((p) => ({ ...p, [co.company]: !p[co.company] }))
                      }
                      aria-expanded={!!openRoles[co.company]}
                    >
                      {openRoles[co.company] ? "▾" : "▸"}{" "}
                      {/* The API caps each company's role list at 60. Saying
                          "60 open roles" next to a "160 roles" badge would just
                          look broken, so name the cap. */}
                      {companyRoles.length < shownCount
                        ? `${companyRoles.length} of ${shownCount} roles`
                        : `${companyRoles.length} open role${companyRoles.length > 1 ? "s" : ""}`}
                    </button>

                    {openRoles[co.company] &&
                      visibleRoles.map((r) => (
                        <div className="rolerow" key={r.url}>
                          <a
                            className="roletitle"
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {r.title}
                          </a>
                          <p className="loc small">
                            📍 {r.location} · {r.exp} · {r.type}
                            {postedAgo(r.updatedAt) && <> · 🕒 {postedAgo(r.updatedAt)}</>}
                            {r.minYears != null && <> · 🎓 {r.minYears}+ yrs</>}
                            {salaryLabel(r.salaryMin, r.salaryMax) && (
                              <> · 💰 {salaryLabel(r.salaryMin, r.salaryMax)}</>
                            )}
                          </p>
                          {r.skills?.length > 0 && (
                            <div className="skillchips small">
                              {r.skills.slice(0, 10).map((s) => (
                                <span
                                  key={s}
                                  className={`chip ${resumeSet.has(s) ? "on" : ""}`}
                                >
                                  {resumeSet.has(s) ? "✓ " : ""}
                                  {skillLabel(s)}
                                </span>
                              ))}
                            </div>
                          )}
                          <Description
                            url={r.url}
                            hasDesc={r.hasDesc}
                            platform={co.platform}
                            state={r.url in openDesc ? openDesc[r.url] : undefined}
                            onToggle={toggleDescription}
                          />
                        </div>
                      ))}

                    {openRoles[co.company] && companyRoles.length > visibleRoles.length && (
                      <button
                        className="descbtn"
                        onClick={() => setShowAllRoles((p) => ({ ...p, [co.company]: true }))}
                      >
                        + show all {companyRoles.length}
                      </button>
                    )}
                  </div>
                )}

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
                    className="resumever"
                    placeholder="Resume version"
                    value={t.resume}
                    onChange={(e) => update(co.company, { resume: e.target.value })}
                    onBlur={(e) => saveTracker(co.company, { resume: e.target.value })}
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
              <b>No data found.</b>
              <br />
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
