// Shared application-tracking constants + DB-backed client helpers. Used by the
// home job board and the profile "Jobs for you" feed so both speak to the same
// per-user job_tracker table in Neon.

export const STATUSES = ["none", "applied", "interview", "rejected"];
export const STATUS_LABEL = {
  none: "Not applied",
  applied: "Applied",
  interview: "Interview",
  rejected: "Rejected",
};
export const EMPTY_ENTRY = { status: "none", notes: "", resume: "" };

import { toast } from "sonner";

export async function loadTracker() {
  try {
    const res = await fetch("/api/tracker", { cache: "no-store" });
    if (!res.ok) throw new Error();
    const json = await res.json();
    return json.tracker || {};
  } catch {
    toast.error("Couldn't load your application tracker.");
    return {};
  }
}

// Save of one job's patch (status / notes / resume).
export async function saveTracker(jobKey, patch) {
  try {
    const res = await fetch("/api/tracker", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobKey, patch }),
    });
    if (!res.ok) throw new Error();
  } catch {
    toast.error("Couldn't save your change.");
  }
}
