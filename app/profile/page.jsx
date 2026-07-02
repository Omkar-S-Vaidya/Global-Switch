"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Nav from "../components/Nav";
import { fetchMe, fileToBase64 } from "../lib/client";
import { parseResumeFile } from "../lib/parseResume";
import { extractSkills, skillLabel, SKILLS } from "../lib/skills";
import { STATUSES, STATUS_LABEL, EMPTY_ENTRY, loadTracker, saveTracker } from "../lib/tracker";
import ResumeEditor from "../components/ResumeEditor";

const JOB_TYPES = ["Full-time", "Contract", "Internship", "Part-time", "Remote", "Hybrid", "On-site"];
const PAGE_SIZE = 20;

// Temporarily disabled — flip to true to re-enable.
const RESUME_EDITOR_ENABLED = false;

const initial = (name = "") => (name.trim()[0] || "?").toUpperCase();
const monoStyle = (name = "") => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return { background: `hsl(${h} 70% 94%)`, color: `hsl(${h} 52% 38%)` };
};

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState("profile"); // profile | jobs

  // profile fields
  const [currentSalary, setCurrentSalary] = useState("");
  const [expectedSalary, setExpectedSalary] = useState("");
  const [jobPreference, setJobPreference] = useState("");
  const [skills, setSkills] = useState([]);
  const [resumeName, setResumeName] = useState("");
  const [hasResume, setHasResume] = useState(false);
  const [pendingResume, setPendingResume] = useState(null); // {name,type,b64,text}
  const [pendingFile, setPendingFile] = useState(null); // raw File for HTML conversion
  const [resumeText, setResumeText] = useState("");
  const [resumeData, setResumeData] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const [loaded, setLoaded] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  // Gate the page.
  useEffect(() => {
    fetchMe().then((u) => {
      if (!u) router.replace("/login");
      else {
        setUser(u);
        setChecking(false);
      }
    });
  }, [router]);

  // Load saved profile.
  useEffect(() => {
    if (checking) return;
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        const json = await res.json();
        const p = json.profile;
        if (p) {
          setCurrentSalary(p.currentSalary);
          setExpectedSalary(p.expectedSalary);
          setJobPreference(p.jobPreference);
          setSkills(p.skills || []);
          setResumeName(p.resumeName);
          setHasResume(p.hasResume);
          setResumeText(p.resumeText || "");
          setResumeData(p.resumeData || null);
        }
      } catch {}
      setLoaded(true);
    })();
  }, [checking]);

  const onFile = async (file) => {
    if (!file) return;
    setParsing(true);
    setErr(null);
    setMsg(null);
    try {
      const [text, b64] = await Promise.all([
        parseResumeFile(file).catch(() => ""),
        fileToBase64(file),
      ]);
      const detected = extractSkills(text || "");
      setPendingResume({ name: file.name, type: file.type || "application/octet-stream", b64, text });
      setPendingFile(file); // keep raw File so the editor can convert it to HTML
      setResumeText(text || "");
      setResumeData(null); // a fresh upload supersedes any previously edited résumé
      setResumeName(file.name);
      setHasResume(true);
      // Merge newly detected skills with existing selection.
      if (detected.length) setSkills((prev) => Array.from(new Set([...prev, ...detected])));
      setMsg(
        detected.length
          ? `Parsed ${detected.length} skills from your resume — review below, then Save.`
          : "Resume attached. Add your skills below, then Save."
      );
    } catch (e) {
      setErr("Couldn't read that file: " + (e?.message || e));
    } finally {
      setParsing(false);
    }
  };

  const toggleSkill = (key) =>
    setSkills((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));

  const save = async () => {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentSalary,
          expectedSalary,
          jobPreference,
          skills,
          resume: pendingResume || undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Save failed");
      setPendingResume(null);
      setMsg("Profile saved ✓");
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const skillSet = useMemo(() => new Set(skills), [skills]);
  const selectedSkills = useMemo(() => SKILLS.filter(([k]) => skillSet.has(k)), [skillSet]);
  const otherSkills = useMemo(() => SKILLS.filter(([k]) => !skillSet.has(k)), [skillSet]);

  if (checking) return <div className="authshell"><div className="spinner" /></div>;

  return (
    <>
      <Nav user={user} />
      <div className="wrap">
        <header className="pagehead">
          <h1>Your profile</h1>
          <p className="sub">
            Add your resume, salary expectations and skills — then see roles matched to you.
          </p>
        </header>

        <div className="segtabs">
          <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>
            👤 Profile
          </button>
          <button className={tab === "jobs" ? "active" : ""} onClick={() => setTab("jobs")}>
            🎯 Jobs for you
          </button>
        </div>

        {tab === "profile" && (
          <div className="panel formpanel">
            {/* Resume */}
            <section className="field">
              <label className="flabel">Resume</label>
              <div className="resumeRow">
                <label className="filebtn">
                  {parsing ? "Reading…" : hasResume ? "Replace resume" : "Upload PDF / DOCX"}
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt"
                    hidden
                    disabled={parsing}
                    onChange={(e) => onFile(e.target.files?.[0])}
                  />
                </label>
                {resumeName && <span className="filename">📎 {resumeName}</span>}
                {hasResume && !pendingResume && (
                  <a className="viewlink" href="/api/profile/resume" target="_blank" rel="noreferrer">
                    View saved
                  </a>
                )}
                {pendingResume && <span className="pendingtag">unsaved</span>}
              </div>
              {RESUME_EDITOR_ENABLED && hasResume && (
                <div style={{ marginTop: 4 }}>
                  <button
                    className="addskills"
                    onClick={() => {
                      setErr(null);
                      setMsg(null);
                      setEditorOpen(true);
                    }}
                  >
                    ✏️ Edit &amp; update résumé
                  </button>
                  <p className="muted small" style={{ margin: "6px 0 0" }}>
                    Open your résumé in an editor to fix your skills or any text, then replace the saved copy or download a fresh PDF.
                  </p>
                </div>
              )}
            </section>

            {/* Salary */}
            <div className="fieldgrid">
              <section className="field">
                <label className="flabel">Current salary</label>
                <input
                  className="finput"
                  placeholder="e.g. S$6,000 / month"
                  value={currentSalary}
                  onChange={(e) => setCurrentSalary(e.target.value)}
                />
              </section>
              <section className="field">
                <label className="flabel">Expected salary</label>
                <input
                  className="finput"
                  placeholder="e.g. S$8,000 / month"
                  value={expectedSalary}
                  onChange={(e) => setExpectedSalary(e.target.value)}
                />
              </section>
            </div>

            {/* Job preference */}
            <section className="field">
              <label className="flabel">Job preference</label>
              <input
                className="finput"
                placeholder="e.g. Backend / Full-stack, remote-friendly"
                value={jobPreference}
                onChange={(e) => setJobPreference(e.target.value)}
              />
              <div className="quickchips">
                {JOB_TYPES.map((t) => {
                  const on = jobPreference.toLowerCase().includes(t.toLowerCase());
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`qchip ${on ? "on" : ""}`}
                      onClick={() =>
                        setJobPreference((prev) => {
                          const has = prev.toLowerCase().includes(t.toLowerCase());
                          if (has)
                            return prev
                              .replace(new RegExp(`\\b${t}\\b,?\\s*`, "i"), "")
                              .replace(/,\s*$/, "")
                              .trim();
                          return prev ? `${prev}, ${t}` : t;
                        })
                      }
                    >
                      {on ? "✓ " : "+ "}
                      {t}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Skills */}
            <section className="field">
              <label className="flabel">
                Skills <span className="muted">({selectedSkills.length} selected)</span>
              </label>
              {selectedSkills.length > 0 && (
                <div className="chipwrap">
                  {selectedSkills.map(([k]) => (
                    <button key={k} className="skill on" onClick={() => toggleSkill(k)}>
                      {skillLabel(k)} ✕
                    </button>
                  ))}
                </div>
              )}
              <p className="muted small" style={{ margin: "10px 0 6px" }}>Add more skills:</p>
              <div className="chipwrap">
                {otherSkills.map(([k]) => (
                  <button key={k} className="skill" onClick={() => toggleSkill(k)}>
                    + {skillLabel(k)}
                  </button>
                ))}
              </div>
            </section>

            {err && <p className="autherr">{err}</p>}
            {msg && <p className="okmsg">{msg}</p>}

            <div className="saverow">
              <button className="authbtn wide" onClick={save} disabled={saving || !loaded}>
                {saving ? "Saving…" : "Save profile"}
              </button>
            </div>
          </div>
        )}

        {tab === "jobs" && (
          <JobsForYou
            skills={skills}
            jobPreference={jobPreference}
            hasProfile={skills.length > 0}
          />
        )}
      </div>

      <ResumeEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={(name) => {
          setResumeName(name);
          setHasResume(true);
          setPendingResume(null);
          setMsg("Résumé updated ✓");
        }}
        skills={skills}
        user={user}
        pendingFile={pendingFile}
        resumeData={resumeData}
        resumeText={resumeText}
      />
    </>
  );
}

// ---- Jobs matched to the saved profile ----
function JobsForYou({ skills, jobPreference, hasProfile }) {
  const [country, setCountry] = useState("singapore");
  const [countries, setCountries] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [tracker, setTracker] = useState({});

  // Same per-user tracker the home board uses, keyed by company.
  useEffect(() => {
    loadTracker().then(setTracker);
  }, []);

  const update = (key, patch, commit = false) => {
    setTracker((prev) => ({ ...prev, [key]: { ...(prev[key] || EMPTY_ENTRY), ...patch } }));
    if (commit) saveTracker(key, patch);
  };

  const load = useCallback(async (key) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs?country=${key}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load");
      setData(json);
      if (json.countries) setCountries(json.countries);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(country);
    setPage(1);
  }, [country, load]);

  const skillSet = useMemo(() => new Set(skills), [skills]);
  const prefTerms = useMemo(
    () =>
      (jobPreference || "")
        .toLowerCase()
        .split(/[,/]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 2),
    [jobPreference]
  );

  const matched = useMemo(() => {
    if (!data?.companies) return [];
    const out = [];
    for (const c of data.companies) {
      for (const r of c.roles || []) {
        const matchedSkills = (r.skills || []).filter((s) => skillSet.has(s));
        const prefHit = prefTerms.some((t) => (r.title || "").toLowerCase().includes(t));
        if (!matchedSkills.length && !prefHit) continue;
        const missing = (r.skills || []).filter((s) => !skillSet.has(s));
        const reqPct = r.skills?.length
          ? Math.round((matchedSkills.length / r.skills.length) * 100)
          : 0;
        out.push({
          company: c.company,
          sector: c.sector,
          title: r.title,
          url: r.url,
          location: r.location,
          exp: r.exp,
          type: r.type,
          score: matchedSkills.length + (prefHit ? 0.5 : 0),
          reqPct,
          matched: matchedSkills,
          missing,
          prefHit,
        });
      }
    }
    out.sort((a, b) => b.score - a.score || b.reqPct - a.reqPct);
    return out;
  }, [data, skillSet, prefTerms]);

  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const pageItems = matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (!hasProfile) {
    return (
      <div className="panel">
        <div className="empty">
          Add some skills to your profile first — then we&apos;ll match live roles to you.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="jobbar">
        <select className="filter" value={country} onChange={(e) => setCountry(e.target.value)}>
          {(countries.length ? countries : [{ key: "singapore", label: "🇸🇬 Singapore" }]).map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <span className="muted small">
          {loading ? "Matching…" : `${matched.length} roles matched to your profile`}
        </span>
      </div>

      {error && <div className="error">Couldn&apos;t load jobs: {error}</div>}

      <div className="grid">
        {pageItems.map((m, i) => {
          const t = tracker[m.company] || EMPTY_ENTRY;
          return (
            <div key={m.company + m.title + i} className={`card ${t.status}`}>
              <div className="cardtop">
                <div className="cardhead">
                  <span className="mono" style={monoStyle(m.company)}>{initial(m.company)}</span>
                  <div className="cardheadtext">
                    <p className="co">{m.company}</p>
                    <p className="role">{m.title}</p>
                    <p className="loc">📍 {m.location} · {m.sector} · {m.exp} · {m.type}</p>
                  </div>
                </div>
                <div className="cardtags">
                  <span className="fitpill">{m.score >= 1 ? `${Math.round(m.score)} skill match` : "preference"} · {m.reqPct}%</span>
                  <span className={`pill ${t.status}`}>{STATUS_LABEL[t.status]}</span>
                </div>
              </div>
              {m.matched.length > 0 && (
                <div className="chipwrap small">
                  {m.matched.map((s) => (
                    <span key={s} className="skill on static">✓ {skillLabel(s)}</span>
                  ))}
                </div>
              )}
              {m.missing.length > 0 && (
                <div className="gaprow">
                  <span className="gaplabel">Missing ({m.missing.length}):</span>
                  <div className="chipwrap small">
                    {m.missing.map((s) => (
                      <span key={s} className="skill miss static">✗ {skillLabel(s)}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="links">
                <a className="lnk pl" href={m.url} target="_blank" rel="noreferrer">🚀 Apply</a>
                <a
                  className="lnk li"
                  href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(m.company + " " + m.title)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  in LinkedIn
                </a>
              </div>
              <div className="statusRow">
                <select value={t.status} onChange={(e) => update(m.company, { status: e.target.value }, true)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>
                <input
                  placeholder="Resume version"
                  value={t.resume}
                  onChange={(e) => update(m.company, { resume: e.target.value })}
                  onBlur={(e) => saveTracker(m.company, { resume: e.target.value })}
                  style={{ width: 150 }}
                />
                <input
                  className="notes"
                  placeholder="Notes (recruiter, referral, follow-up…)"
                  value={t.notes}
                  onChange={(e) => update(m.company, { notes: e.target.value })}
                  onBlur={(e) => saveTracker(m.company, { notes: e.target.value })}
                />
              </div>
            </div>
          );
        })}
        {!loading && pageItems.length === 0 && (
          <div className="empty">No live roles match your profile in this country yet — try another country.</div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="pager">
          <button className="btn ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
          <span className="muted small">Page {page} / {totalPages}</span>
          <button className="btn ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}
