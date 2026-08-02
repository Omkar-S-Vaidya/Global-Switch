"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Nav from "../components/Nav";
import { fetchMe, fileToBase64 } from "../lib/client";
import { parseResumeFile } from "../lib/parseResume";
import { extractSkills, skillLabel, SKILLS } from "../lib/skills";
import ResumeEditor from "../components/ResumeEditor";

const JOB_TYPES = ["Full-time", "Contract", "Internship", "Part-time", "Remote", "Hybrid", "On-site"];

// Temporarily disabled — flip to true to re-enable.
const RESUME_EDITOR_ENABLED = false;


export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

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
        if (!res.ok) throw new Error(`Server error (${res.status})`);
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
      } catch (e) {
        toast.error("Couldn't load your profile: " + e.message);
      }
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
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Save failed");
      setPendingResume(null);
      setMsg("Profile saved ✓");
      toast.success("Profile saved");
    } catch (e) {
      setErr(e.message);
      toast.error("Couldn't save profile: " + e.message);
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

        {/* Matched roles used to live here too, on a separate skill set that
            silently disagreed with the job board's. There is now one matcher,
            reading these saved skills, on the Jobs page. */}
        {skills.length > 0 && (
          <div className="crosslink">
            <span>
              🎯 <b>{skills.length} skills</b> saved — the Jobs board ranks every live role
              against them.
            </span>
            <button className="btn" onClick={() => router.push("/")}>
              See matched roles →
            </button>
          </div>
        )}

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
