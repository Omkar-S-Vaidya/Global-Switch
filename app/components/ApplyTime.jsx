"use client";

import { useEffect, useState } from "react";
import { bestApplyTime } from "../lib/applyTime";

// Shows the recommended apply time (8 AM in the role's timezone) converted to
// the viewer's local time. Computed in an effect so it matches the client's
// timezone (avoids SSR/hydration mismatch).
export default function ApplyTime({ country, countryLabel }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    setInfo(bestApplyTime(country));
    // Refresh across a DST boundary / at midnight if the page stays open long.
    const id = setInterval(() => setInfo(bestApplyTime(country)), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [country]);

  if (!info) return null;
  const where = (countryLabel || "").replace(/^[^\w]+/, "").trim();

  return (
    <div className="applytime" title="Recruiters usually review applications at the start of their workday.">
      <span className="applytimeIcon">⏰</span>
      <span>
        <b>Best time to apply:</b> {info.jobTime} {where && `in ${where} `}({info.jobTz}) —
        that&apos;s <b>{info.localTime}</b> your time{info.localTz ? ` (${info.localTz})` : ""}
      </span>
    </div>
  );
}
