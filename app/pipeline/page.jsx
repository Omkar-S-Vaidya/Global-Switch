"use client";

// The daily pipeline: quota progress, who to chase today, and the full
// application log.
//
// Quota is per bucket per day (15 remote / 10 each country ≈ 275 a week), and
// each bucket carries its suggested IST time block so the dashboard can point
// at what you should be working on right now.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Nav from "../components/Nav";
import { fetchMe } from "../lib/client";
import { BUCKETS, APP_STATUSES, APP_STATUS_LABEL, slotLabel } from "../lib/buckets";
import { todayLocal, addDays, fmtDay, relativeDay, FOLLOW_UP_DAYS } from "../lib/dates";

export default function PipelinePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState("");
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const [editTargets, setEditTargets] = useState(false);
  const [targets, setTargets] = useState({});
  const today = useMemo(() => todayLocal(), []);

  useEffect(() => {
    fetchMe().then((u) => (u ? setUser(u) : router.replace("/login")));
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ today });
      if (bucket) p.set("bucket", bucket);
      if (status) p.set("status", status);
      const res = await fetch(`/api/applications?${p}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed");
      setData(json);
      setTargets(json.targets);
    } catch (e) {
      toast.error("Couldn't load your pipeline: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [today, bucket, status]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const patch = async (id, body) => {
    const res = await fetch("/api/applications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if ((await res.json()).ok) load();
    else toast.error("Couldn't save that change.");
  };

  const remove = async (id) => {
    await fetch(`/api/applications?id=${id}`, { method: "DELETE" });
    load();
  };

  const onAdd = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: f.companyName,
        roleTitle: f.roleTitle,
        roleUrl: f.roleUrl,
        bucket: f.bucket,
        status: "applied",
        appliedOn: f.appliedOn || today,
        followUpOn: addDays(f.appliedOn || today, FOLLOW_UP_DAYS),
        source: f.source,
      }),
    });
    if ((await res.json()).ok) {
      toast.success("Application logged.");
      setAdding(false);
      e.target.reset();
      load();
    } else toast.error("Couldn't log that application.");
  };

  const saveTargets = async () => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets }),
    });
    const json = await res.json();
    if (json.ok) {
      toast.success("Daily targets saved.");
      setEditTargets(false);
      load();
    } else toast.error("Couldn't save targets.");
  };

  // Which bucket's time block is running now (IST hours from the strategy,
  // matched against the viewer's own clock).
  const activeBucket = useMemo(() => {
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    return BUCKETS.find((b) => b.slot && h >= b.slot[0] && h < b.slot[1])?.key || null;
  }, []);

  const totals = useMemo(() => {
    const p = data?.progress || {};
    const vals = Object.values(p);
    return {
      today: vals.reduce((s, v) => s + v.today, 0),
      target: vals.reduce((s, v) => s + v.target, 0),
      week: vals.reduce((s, v) => s + v.week, 0),
    };
  }, [data]);

  if (!user) return <div className="loading">Loading…</div>;

  const apps = data?.applications || [];
  const followUps = data?.followUps || [];

  return (
    <>
      <Nav user={user} />
      <main className="wrap">
        <header className="pagehead">
          <div>
            <h1>📈 Pipeline</h1>
            <p className="sub">
              {totals.today} of {totals.target} applications today · {totals.week} this week
              {totals.week >= 250 ? " — on pace" : ""}
            </p>
          </div>
          <div className="stats">
            {["applied", "interview", "offer", "rejected"].map((k) => (
              <div className="stat" key={k}>
                <b>{data?.statusCounts?.[k] || 0}</b>
                <span>{APP_STATUS_LABEL[k]}</span>
              </div>
            ))}
          </div>
        </header>

        {/* ---------------- Daily quota ---------------- */}
        <section className="panel">
          <div className="panelhead">
            <span>🎯 Today&apos;s quota</span>
            {editTargets ? (
              <span>
                <button className="btn primary sm" onClick={saveTargets}>
                  Save
                </button>{" "}
                <button className="btn ghost sm" onClick={() => setEditTargets(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="btn ghost sm" onClick={() => setEditTargets(true)}>
                Edit targets
              </button>
            )}
          </div>

          <div className="quotagrid">
            {BUCKETS.map((b) => {
              const p = data?.progress?.[b.key] || { today: 0, week: 0, target: b.target };
              const pct = p.target ? Math.min(100, Math.round((p.today / p.target) * 100)) : 0;
              const done = p.target > 0 && p.today >= p.target;
              return (
                <div
                  key={b.key}
                  className={`quota ${done ? "done" : ""} ${activeBucket === b.key ? "now" : ""}`}
                >
                  <div className="quotatop">
                    <span className="quotaname">{b.label}</span>
                    {activeBucket === b.key && <span className="nowtag">now</span>}
                  </div>
                  <div className="quotanums">
                    <b>{p.today}</b>
                    <span className="muted">/</span>
                    {editTargets ? (
                      <input
                        className="targetinput"
                        type="number"
                        min="0"
                        value={targets[b.key] ?? b.target}
                        onChange={(e) =>
                          setTargets((t) => ({ ...t, [b.key]: Number(e.target.value) }))
                        }
                      />
                    ) : (
                      <span className="muted">{p.target}</span>
                    )}
                  </div>
                  <div className="bar">
                    <div className="barfill" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="small muted">
                    {slotLabel(b.slot)} · {p.week} this week
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---------------- Follow-ups ---------------- */}
        <section className="panel">
          <div className="panelhead">
            <span>🔔 Follow up today {followUps.length > 0 && <b>({followUps.length})</b>}</span>
          </div>
          {!followUps.length ? (
            <p className="small muted" style={{ padding: "4px 2px" }}>
              Nothing due. Applications get a follow-up date {FOLLOW_UP_DAYS} days out when you log
              them.
            </p>
          ) : (
            <div className="folist">
              {followUps.map((f) => (
                <div key={f.id} className="forow">
                  <div className="coinfo">
                    <p className="co">
                      {f.company_name}
                      {f.role_title ? <span className="muted"> · {f.role_title}</span> : null}
                    </p>
                    <p className="small muted">
                      Applied {fmtDay(f.applied_on)} · due {relativeDay(f.follow_up_on, today)}
                    </p>
                  </div>
                  <div className="colinks">
                    <button
                      className="viewlink applied"
                      onClick={() => patch(f.id, { followUpOn: addDays(today, 3) })}
                    >
                      Snooze 3d
                    </button>
                    <button
                      className="viewlink careers"
                      onClick={() => patch(f.id, { status: "screening", followUpOn: addDays(today, 5) })}
                    >
                      Heard back
                    </button>
                    <button className="viewlink linkedin" onClick={() => patch(f.id, { clearFollowUp: true })}>
                      Done
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---------------- Log ---------------- */}
        <div className="toolbar">
          <select className="filter" value={bucket} onChange={(e) => setBucket(e.target.value)}>
            <option value="">All buckets</option>
            {BUCKETS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
          <select className="filter" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {APP_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "+ Log application"}
          </button>
          <span className="sub">{apps.length} applications</span>
        </div>

        {adding && (
          <form className="addform" onSubmit={onAdd}>
            <input name="companyName" placeholder="Company" required />
            <input name="roleTitle" placeholder="Role title" />
            <input name="roleUrl" placeholder="Job URL" />
            <select name="bucket" defaultValue="remote">
              {BUCKETS.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </select>
            <input name="appliedOn" type="date" defaultValue={today} />
            <input name="source" placeholder="Source (LinkedIn, careers page…)" />
            <button className="btn primary" type="submit">
              Log it
            </button>
          </form>
        )}

        {loading && <div className="loading">Loading…</div>}

        {!loading && !apps.length && (
          <div className="empty">
            No applications logged yet. Mark one from the{" "}
            <a href="/companies">company database</a> or log it by hand above.
          </div>
        )}

        <div className="colist">
          {apps.map((a) => (
            <div key={a.id} className={`corow st-${a.status}`}>
              <div className="coinfo">
                <p className="co">
                  {a.role_url ? (
                    <a href={a.role_url} target="_blank" rel="noreferrer">
                      {a.company_name}
                    </a>
                  ) : (
                    a.company_name
                  )}
                  {a.role_title ? <span className="muted"> · {a.role_title}</span> : null}
                </p>
                <p className="small muted">
                  {BUCKETS.find((b) => b.key === a.bucket)?.label || a.bucket} · applied{" "}
                  {fmtDay(a.applied_on)}
                  {a.follow_up_on ? ` · follow up ${fmtDay(a.follow_up_on)}` : ""}
                  {a.source ? ` · ${a.source}` : ""}
                </p>
              </div>
              <div className="colinks">
                <select
                  className="minisel"
                  value={a.status}
                  onChange={(e) => patch(a.id, { status: e.target.value })}
                >
                  {APP_STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button className="viewlink del" onClick={() => remove(a.id)} title="Delete">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
