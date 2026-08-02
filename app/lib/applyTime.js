// "Best time to apply" = early in the job's local workday (recruiters review
// applications at the start of the day, so being near the top of the pile helps).
// We compute 8:00 AM in the role's country timezone and convert it to the
// viewer's local time. All timezone math uses the Intl API (no dependencies).

export const COUNTRY_TZ = {
  // "remote" is deliberately absent — a distributed team has no single local
  // morning, so bestApplyTime() returns null and the banner is hidden.
  netherlands: "Europe/Amsterdam",
  singapore: "Asia/Singapore",
  india: "Asia/Kolkata",
  us: "America/New_York",
  uk: "Europe/London",
  australia: "Australia/Sydney",
  canada: "America/Toronto",
  germany: "Europe/Berlin",
  switzerland: "Europe/Zurich",
  uae: "Asia/Dubai",
  japan: "Asia/Tokyo",
};

const BEST_HOUR = 8; // 8:00 AM local to the role

// Minutes the timezone is ahead of UTC at the given instant.
function tzOffsetMin(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = dtf.formatToParts(date).reduce((a, x) => ((a[x.type] = x.value), a), {});
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return (asUTC - date.getTime()) / 60000;
}

function fmtTime(date, timeZone) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

function tzAbbr(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}),
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((p) => p.type === "timeZoneName")?.value || "";
}

// Returns { jobTime, jobTz, localTime, localTz } or null if the country has no
// mapped timezone. Call on the client (uses the viewer's local timezone).
export function bestApplyTime(countryKey, now = new Date()) {
  const tz = COUNTRY_TZ[countryKey];
  if (!tz) return null;

  // Today's calendar date in the role's timezone.
  const d = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .reduce((a, x) => ((a[x.type] = x.value), a), {});

  // Instant that reads as 08:00 wall-clock in the role's timezone.
  const guess = Date.UTC(+d.year, +d.month - 1, +d.day, BEST_HOUR, 0, 0);
  const off = tzOffsetMin(new Date(guess), tz);
  const instant = new Date(guess - off * 60000);

  return {
    jobTime: fmtTime(instant, tz),
    jobTz: tzAbbr(instant, tz),
    localTime: fmtTime(instant),
    localTz: tzAbbr(instant),
  };
}
