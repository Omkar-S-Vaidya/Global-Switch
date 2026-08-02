// The five focus buckets of the search strategy — "don't apply to 10 countries,
// apply to 4 + Remote". Priority order is the recommended one: a remote offer
// gives international experience without a visa, which in turn makes the
// sponsored roles easier later. `target` is the daily application quota.
//
// `countryKey` maps a bucket onto the live-jobs country filter in /api/jobs.

// `slot` is the suggested IST time block for that bucket's applications — the
// daily timetable, so the dashboard can show what you should be working on now.
export const BUCKETS = [
  { key: "remote", label: "🌍 Remote", flag: "🌍", short: "Remote", countryKey: "remote", target: 15, slot: [20.5, 22] },
  { key: "netherlands", label: "🇳🇱 Netherlands", flag: "🇳🇱", short: "Netherlands", countryKey: "netherlands", target: 10, slot: [14.5, 15.5] },
  { key: "germany", label: "🇩🇪 Germany", flag: "🇩🇪", short: "Germany", countryKey: "germany", target: 10, slot: [13.5, 14.5] },
  { key: "uk", label: "🇬🇧 United Kingdom", flag: "🇬🇧", short: "UK", countryKey: "uk", target: 10, slot: [17, 18] },
  { key: "india", label: "🇮🇳 India", flag: "🇮🇳", short: "India", countryKey: "india", target: 10, slot: [9, 10] },
];

// "13.5" → "1:30 PM"
export function slotLabel(slot) {
  if (!slot) return "";
  const fmt = (h) => {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    const ampm = hh >= 12 ? "PM" : "AM";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
  };
  return `${fmt(slot[0])}–${fmt(slot[1])}`;
}

export const BUCKET_KEYS = BUCKETS.map((b) => b.key);
const BY_KEY = Object.fromEntries(BUCKETS.map((b) => [b.key, b]));

export function bucket(key) {
  return BY_KEY[key] || null;
}
export function bucketLabel(key) {
  return BY_KEY[key]?.label || key;
}

// Default daily quota per bucket → ~275 applications/week.
export const DEFAULT_TARGETS = Object.fromEntries(BUCKETS.map((b) => [b.key, b.target]));

export const WEEKLY_TOTAL = BUCKETS.reduce((s, b) => s + b.target, 0) * 5;

// Application funnel. `open` statuses still count as live pipeline.
export const APP_STATUSES = [
  { key: "saved", label: "Saved", open: true },
  { key: "applied", label: "Applied", open: true },
  { key: "screening", label: "Recruiter screen", open: true },
  { key: "interview", label: "Interview", open: true },
  { key: "offer", label: "Offer", open: true },
  { key: "rejected", label: "Rejected", open: false },
  { key: "ghosted", label: "No response", open: false },
];
export const APP_STATUS_LABEL = Object.fromEntries(APP_STATUSES.map((s) => [s.key, s.label]));
// Everything from "applied" onwards counts toward the daily quota.
export const COUNTED_STATUSES = ["applied", "screening", "interview", "offer", "rejected", "ghosted"];

export const VISA_OPTIONS = [
  { key: "yes", label: "Sponsors" },
  { key: "likely", label: "Likely" },
  { key: "unknown", label: "Unknown" },
  { key: "no", label: "No sponsorship" },
];
export const REMOTE_OPTIONS = [
  { key: "remote", label: "Remote" },
  { key: "hybrid", label: "Hybrid" },
  { key: "onsite", label: "On-site" },
  { key: "unknown", label: "Unknown" },
];
