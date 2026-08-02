// Pulling a years-of-experience requirement out of free-text job descriptions.
//
// Measured coverage on live data: Greenhouse 87%, Arbeitnow 28%, Remotive 24%,
// Ashby 20% — 44% overall. Plenty of employers (European ones especially) never
// state a number, so anything built on this must say how many roles it couldn't
// read rather than silently dropping them.

// "3+ years", "5 plus years", "3-5 years", "3 to 5 years", "5 or more years".
const YEARS_RE =
  /(?:(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|—|to)\s*(\d{1,2})|(\d{1,2})\s*(?:\+|plus))\s*(?:or more\s*)?years?/gi;

// A bare number near "years" isn't a requirement — "10 years of growth" and
// "founded 5 years ago" both appear in company blurbs. Require an experience
// word in the surrounding window.
const CONTEXT_RE = /experien|\bexp\b|background|working|track record|hands.?on/i;

/**
 * Lowest stated years-of-experience requirement in the text, or null.
 * The lowest is the real bar: a posting listing "3+ years backend" and
 * "8+ years for the senior track" is open to the 3-year candidate.
 */
export function parseYears(text = "") {
  if (!text) return null;
  let best = null;
  for (const m of text.matchAll(YEARS_RE)) {
    const window = text.slice(Math.max(0, m.index - 60), m.index + 90);
    if (!CONTEXT_RE.test(window)) continue;
    const n = Number(m[1] ?? m[3]);
    if (!Number.isFinite(n) || n < 1 || n > 20) continue;
    if (best === null || n < best) best = n;
  }
  return best;
}

// Buckets for the filter. "max" is inclusive — picking 5 shows everything a
// candidate with 5 years could apply to.
export const YEAR_FILTERS = [
  { key: "all", label: "Any experience level" },
  { key: "3", label: "Wants ≤ 3 years", max: 3 },
  { key: "5", label: "Wants ≤ 5 years", max: 5 },
  { key: "8", label: "Wants ≤ 8 years", max: 8 },
  { key: "none", label: "No years stated" },
];

export function matchesYears(minYears, filterKey) {
  if (!filterKey || filterKey === "all") return true;
  if (filterKey === "none") return minYears == null;
  if (minYears == null) return false; // can't prove it fits, so don't claim it does
  return minYears <= Number(filterKey);
}
