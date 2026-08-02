// Keyless public job feeds, used alongside the company boards.
//
// These exist because the two weakest buckets are the two that matter most:
// Remote had the fewest companies of any bucket despite being top priority, and
// Germany's résumé matching was crippled by Arbeitsagentur returning bare titles
// with no description. Remotive and RemoteOK also publish salary, which no
// company board in the Remote bucket does.
//
// Every reader returns the same normalized shape the jobs route already merges:
//   { company, title, url, location, created, salaryMin, salaryMax, type, sector, skills }
// and never throws — a feed that's down degrades to [] on its own.

import { extractSkills } from "./skills";
import { parseYears } from "./experience";

const UA = { "User-Agent": "JobHuntCommandCenter/1.0", Accept: "application/json" };

// Decode before stripping: sources that return HTML-encoded bodies would
// otherwise leave tag names behind as literal words ("h2 strong Who we are").
// No truncation here — callers decide, and the years requirement usually sits
// near the END of a posting.
function decodeEntities(s = "") {
  return s
    .replace(/&(?:amp|#38);/gi, "&")
    .replace(/&(?:lt|#60);/gi, "<")
    .replace(/&(?:gt|#62);/gi, ">")
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function stripHtml(s = "") {
  return decodeEntities(s)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseType(t = "") {
  if (/\bintern(ship)?\b/i.test(t)) return "internship";
  if (/contract|contractor|temporary|fixed.?term|freelance/i.test(t)) return "contract";
  if (/part.?time/i.test(t)) return "parttime";
  return "fulltime";
}

async function getJson(url) {
  const res = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

// Some feeds quote salary as a free-text string ("$120,000 - $160,000").
function parseSalaryText(s = "") {
  if (!s) return [null, null];
  const nums = String(s)
    .replace(/,/g, "")
    .match(/\d{4,7}/g);
  if (!nums?.length) return [null, null];
  const vals = nums.map(Number).filter((n) => n >= 1000 && n <= 1_000_000);
  if (!vals.length) return [null, null];
  return vals.length === 1 ? [vals[0], null] : [Math.min(...vals), Math.max(...vals)];
}

// ---- Remote-first feeds ---------------------------------------------------

export async function fetchRemotive() {
  const data = await getJson("https://remotive.com/api/remote-jobs?category=software-dev&limit=200");
  return (data.jobs || []).map((j) => {
    const [lo, hi] = parseSalaryText(j.salary);
    return {
      company: (j.company_name || "").trim() || "Employer (via Remotive)",
      title: j.title,
      url: j.url,
      location: j.candidate_required_location || "Remote",
      created: j.publication_date || null,
      salaryMin: lo,
      salaryMax: hi,
      type: j.job_type === "contract" ? "contract" : parseType(j.title),
      sector: j.category || "Software",
      desc: stripHtml(j.description || ""),
      skills: extractSkills(`${j.title} ${(j.tags || []).join(" ")} ${stripHtml(j.description || "")}`),
    };
  });
}

export async function fetchRemoteOK() {
  const data = await getJson("https://remoteok.com/api");
  // The first element is the API's legal notice, not a job.
  const rows = Array.isArray(data) ? data.slice(1) : [];
  return rows.map((j) => ({
    company: (j.company || "").trim() || "Employer (via RemoteOK)",
    title: j.position || j.title,
    url: j.url || j.apply_url,
    location: j.location || "Remote",
    created: j.date || (j.epoch ? new Date(j.epoch * 1000).toISOString() : null),
    salaryMin: j.salary_min || null,
    salaryMax: j.salary_max || null,
    type: parseType(j.position || ""),
    sector: (j.tags || [])[0] || "Software",
    desc: stripHtml(j.description || ""),
    skills: extractSkills(`${j.position || ""} ${(j.tags || []).join(" ")} ${stripHtml(j.description || "")}`),
  }));
}

export async function fetchJobicy() {
  const data = await getJson("https://jobicy.com/api/v2/remote-jobs?count=100&industry=engineering");
  return (data.jobs || []).map((j) => ({
    company: (j.companyName || "").trim() || "Employer (via Jobicy)",
    title: j.jobTitle,
    url: j.url,
    location: j.jobGeo || "Remote",
    created: j.pubDate || null,
    salaryMin: j.annualSalaryMin ? Number(j.annualSalaryMin) : null,
    salaryMax: j.annualSalaryMax ? Number(j.annualSalaryMax) : null,
    type: parseType(`${j.jobTitle} ${(j.jobType || []).join(" ")}`),
    sector: Array.isArray(j.jobIndustry) ? j.jobIndustry[0] : j.jobIndustry || "Software",
    desc: stripHtml(j.jobDescription || j.jobExcerpt || ""),
    skills: extractSkills(
      `${j.jobTitle} ${stripHtml(j.jobDescription || j.jobExcerpt || "")} ${j.jobLevel || ""}`
    ),
  }));
}

export async function fetchHimalayas() {
  const data = await getJson("https://himalayas.app/jobs/api?limit=100");
  return (data.jobs || []).map((j) => ({
    company: (j.companyName || "").trim() || "Employer (via Himalayas)",
    title: j.title,
    url: j.applicationLink || j.guid,
    location: (j.locationRestrictions || []).join(", ") || "Remote",
    created: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : null,
    salaryMin: j.minSalary || null,
    salaryMax: j.maxSalary || null,
    type: parseType(j.title),
    sector: (j.categories || [])[0] || "Software",
    desc: stripHtml(j.description || ""),
    skills: extractSkills(`${j.title} ${stripHtml(j.description || "")} ${(j.categories || []).join(" ")}`),
  }));
}

// ---- Germany / EU ---------------------------------------------------------

// Arbeitnow is the fix for Germany's matching problem: unlike Arbeitsagentur it
// ships the full description, so the skill extractor has something to read.
export async function fetchArbeitnow() {
  const out = [];
  for (const page of [1, 2]) {
    let data;
    try {
      data = await getJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
    } catch {
      break;
    }
    const rows = data.data || [];
    for (const j of rows) {
      out.push({
        company: (j.company_name || "").trim() || "Employer (via Arbeitnow)",
        title: j.title,
        url: j.url,
        location: j.remote ? `Remote — ${j.location || "Germany"}` : j.location || "Germany",
        created: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
        salaryMin: null,
        salaryMax: null,
        type: parseType(`${j.title} ${(j.job_types || []).join(" ")}`),
        sector: (j.tags || [])[0] || "IT",
        desc: stripHtml(j.description || ""),
        skills: extractSkills(`${j.title} ${stripHtml(j.description || "")} ${(j.tags || []).join(" ")}`),
      });
    }
    if (rows.length < 100) break;
  }
  return out;
}

// Every feed, with the buckets it serves. `remoteOnly` feeds are skipped for
// country views because their postings are location-agnostic by definition.
const DESC_CAP = 6000;

// Same enrichment readBoard() applies to ATS boards, for the feed sources.
// Scan the full text, store the capped copy — scanning the truncated version
// dropped years-requirement coverage from 87% to 10%.
export function enrichFeed(jobs) {
  return jobs.map((j) => {
    const full = j.desc || "";
    return { ...j, minYears: parseYears(`${j.title} ${full}`), desc: full.slice(0, DESC_CAP) };
  });
}

export const FEEDS = [
  { key: "remotive", label: "Remotive", fetch: fetchRemotive, countries: ["remote"] },
  { key: "remoteok", label: "RemoteOK", fetch: fetchRemoteOK, countries: ["remote"] },
  { key: "jobicy", label: "Jobicy", fetch: fetchJobicy, countries: ["remote"] },
  { key: "himalayas", label: "Himalayas", fetch: fetchHimalayas, countries: ["remote"] },
  // Germany only. Arbeitnow carries plenty of onsite Berlin roles, and letting
  // those into the Remote bucket would dilute the highest-priority list.
  { key: "arbeitnow", label: "Arbeitnow", fetch: fetchArbeitnow, countries: ["germany"] },
];
