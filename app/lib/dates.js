// Local-day helpers. Everything the quota and follow-up logic counts is keyed on
// the user's own calendar day, not UTC — applying at 1am IST must land on today.

export function todayLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return todayLocal(dt);
}

// "in 3 days" / "today" / "4 days ago" — for the follow-up queue.
export function relativeDay(isoDate, today = todayLocal()) {
  if (!isoDate) return "";
  const diff = Math.round(
    (new Date(isoDate + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000
  );
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days overdue`;
}

export function fmtDay(isoDate) {
  if (!isoDate) return "—";
  const s = String(isoDate).slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y) return "—";
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

// The default chase window: a week after applying.
export const FOLLOW_UP_DAYS = 7;
