// Multi-ATS board readers.
//
// The whole point of the company database is that a company row carrying an ATS
// token stops being a careers page you have to remember to check — its openings
// come to you. Each adapter below turns { ats, token } into the same normalized
// job shape the jobs route already speaks:
//
//   { title, url, location, created, salaryMin, salaryMax, type, sector, skills }
//
// Greenhouse was already wired up; Lever, Ashby, Recruitee, SmartRecruiters,
// Workable and Personio are added because between them they cover most of the
// European mid-market — Recruitee and Homerun in particular are near-ubiquitous
// among Dutch employers, and Personio among German ones.

import { extractSkills } from "./skills";

// Order matters: probing stops at the first hit, and Workday is deliberately
// last because it's the only one that needs a 3-part token guessed by brute
// force (see WD_DCS × WD_SITES below) rather than a single slug.
export const ATS_TYPES = [
  "greenhouse",
  "lever",
  "ashby",
  "recruitee",
  "smartrecruiters",
  "workable",
  "personio",
  "workday",
];

export const ATS_LABEL = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  recruitee: "Recruitee",
  smartrecruiters: "SmartRecruiters",
  workable: "Workable",
  personio: "Personio",
  workday: "Workday",
};

// Workday URLs need tenant + datacenter + site path, and none of the three is
// discoverable: the tenant host is a wildcard (every name resolves) and the root
// returns 406 without a JSON Accept header. Only the jobs endpoint answers
// truthfully, so these are the combinations worth trying. Every pair confirmed
// so far has been on wd3.
const WD_DCS = ["wd3", "wd5", "wd1"];
const WD_SITES = ["External", "Careers", "Jobs", "jobs-and-careers"];

function stripHtml(s = "") {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .slice(0, 4000);
}

function parseType(t = "") {
  if (/\bintern(ship)?\b/i.test(t)) return "internship";
  if (/contract|contractor|temporary|fixed.?term|freelance|c2c/i.test(t)) return "contract";
  if (/part.?time/i.test(t)) return "parttime";
  return "fulltime";
}

const JSON_HEADERS = { "User-Agent": "JobHuntCommandCenter/1.0", Accept: "application/json" };

async function getJson(url, init) {
  const res = await fetch(url, {
    headers: JSON_HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
    ...init,
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "JobHuntCommandCenter/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

// The public careers page for a board — what you'd bookmark in the spreadsheet.
export function boardUrl(ats, token, site) {
  switch (ats) {
    case "greenhouse":
      return `https://job-boards.greenhouse.io/${token}`;
    case "lever":
      return `https://jobs.lever.co/${token}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${token}`;
    case "recruitee":
      return `https://${token}.recruitee.com/`;
    case "smartrecruiters":
      return `https://jobs.smartrecruiters.com/${token}`;
    case "workable":
      return `https://apply.workable.com/${token}/`;
    case "personio":
      return `https://${token}.jobs.personio.de/`;
    case "workday": {
      const [tenant, dc, site] = String(token).split(":");
      return tenant && dc && site
        ? `https://${tenant}.${dc}.myworkdayjobs.com/en-US/${site}`
        : null;
    }
    default:
      return site ? `https://${site.replace(/^https?:\/\//, "")}/careers` : null;
  }
}

// ---------------------------------------------------------------- adapters

async function readGreenhouse(token) {
  const data = await getJson(
    `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`
  );
  return (data.jobs || []).map((j) => ({
    title: j.title,
    url: j.absolute_url,
    location: j.location?.name || "",
    created: j.updated_at || null,
    salaryMin: null,
    salaryMax: null,
    type: parseType(j.title),
    sector: null,
    skills: extractSkills(`${j.title} ${stripHtml(j.content || "")}`),
  }));
}

async function readLever(token) {
  const data = await getJson(`https://api.lever.co/v0/postings/${token}?mode=json`);
  return (Array.isArray(data) ? data : []).map((j) => ({
    title: j.text,
    url: j.hostedUrl || j.applyUrl,
    location: j.categories?.location || "",
    created: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    salaryMin: null,
    salaryMax: null,
    type: parseType(`${j.text} ${j.categories?.commitment || ""}`),
    sector: j.categories?.team || null,
    skills: extractSkills(`${j.text} ${j.descriptionPlain || stripHtml(j.description || "")}`),
  }));
}

async function readAshby(token) {
  const data = await getJson(
    `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`
  );
  return (data.jobs || []).map((j) => {
    const comp = j.compensation?.summaryComponents?.[0] || {};
    return {
      title: j.title,
      url: j.jobUrl || j.applyUrl,
      location: j.location || j.address?.postalAddress?.addressLocality || "",
      created: j.publishedAt || null,
      salaryMin: comp.minValue ?? null,
      salaryMax: comp.maxValue ?? null,
      type: parseType(`${j.title} ${j.employmentType || ""}`),
      sector: j.department || j.team || null,
      skills: extractSkills(`${j.title} ${j.descriptionPlain || ""} ${j.department || ""}`),
    };
  });
}

async function readRecruitee(token) {
  const data = await getJson(`https://${token}.recruitee.com/api/offers/`);
  return (data.offers || []).map((j) => ({
    title: j.title,
    url: j.careers_url || j.careers_apply_url,
    location: [j.city, j.country].filter(Boolean).join(", "),
    created: j.published_at || j.created_at || null,
    salaryMin: j.min_salary ?? null,
    salaryMax: j.max_salary ?? null,
    type: parseType(`${j.title} ${j.employment_type_code || ""}`),
    sector: j.department || null,
    skills: extractSkills(
      `${j.title} ${stripHtml(j.description || "")} ${stripHtml(j.requirements || "")}`
    ),
  }));
}

async function readSmartRecruiters(token) {
  const data = await getJson(
    `https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`
  );
  return (data.content || []).map((j) => ({
    title: j.name,
    url: `https://jobs.smartrecruiters.com/${token}/${j.id}`,
    location: [j.location?.city, j.location?.country].filter(Boolean).join(", "),
    created: j.releasedDate || j.createdOn || null,
    salaryMin: null,
    salaryMax: null,
    type: parseType(`${j.name} ${j.typeOfEmployment?.label || ""}`),
    sector: j.department?.label || j.function?.label || null,
    skills: extractSkills(`${j.name} ${j.department?.label || ""}`),
  }));
}

async function readWorkable(token) {
  const data = await getJson(
    `https://apply.workable.com/api/v1/widget/accounts/${token}?details=true`
  );
  return (data.jobs || []).map((j) => ({
    title: j.title,
    url: j.url || j.application_url,
    location: [j.city, j.country].filter(Boolean).join(", ") || j.location || "",
    created: j.published_on || null,
    salaryMin: null,
    salaryMax: null,
    type: parseType(`${j.title} ${j.employment_type || ""}`),
    sector: j.department || null,
    skills: extractSkills(`${j.title} ${stripHtml(j.description || "")} ${stripHtml(j.requirements || "")}`),
  }));
}

// Personio publishes a plain XML feed rather than JSON. The document is flat and
// machine-generated, so a tag scan is enough — no XML parser dependency needed.
function xmlTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return "";
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}
async function readPersonio(token) {
  const xml = await getText(`https://${token}.jobs.personio.de/xml`);
  const blocks = xml.match(/<position>[\s\S]*?<\/position>/gi) || [];
  return blocks.map((b) => {
    const id = xmlTag(b, "id");
    const title = xmlTag(b, "name");
    const office = xmlTag(b, "office");
    return {
      title,
      url: `https://${token}.jobs.personio.de/job/${id}`,
      location: office,
      created: xmlTag(b, "createdAt") || null,
      salaryMin: null,
      salaryMax: null,
      type: parseType(`${title} ${xmlTag(b, "employmentType")}`),
      sector: xmlTag(b, "department") || null,
      skills: extractSkills(`${title} ${stripHtml(b)}`),
    };
  });
}

// Workday. Token is "tenant:datacenter:site". Two quirks shape this adapter:
// the list endpoint caps `limit` at 20, and it returns no description — only a
// title — so extracted skills are title-only and résumé matching against these
// roles is weaker than against a Greenhouse or Ashby board.
function workdayPostedDays(s = "") {
  if (/today/i.test(s)) return 0;
  if (/yesterday/i.test(s)) return 1;
  const m = s.match(/(\d+)\+?\s*days?/i);
  return m ? Number(m[1]) : null;
}

async function readWorkday(token, { pages = 3 } = {}) {
  const [tenant, dc, site] = String(token).split(":");
  if (!tenant || !dc || !site) return [];
  const base = `https://${tenant}.${dc}.myworkdayjobs.com`;
  const seen = new Set();
  const out = [];

  // Searching beats paging blindly: a big tenant can have 1,000+ postings and
  // only a fraction are engineering, so ask for the ones we want.
  for (const searchText of ["software engineer", "developer"]) {
    for (let page = 0; page < pages; page++) {
      let data;
      try {
        const res = await fetch(`${base}/wday/cxs/${tenant}/${site}/jobs`, {
          method: "POST",
          headers: { ...JSON_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: page * 20, searchText }),
          cache: "no-store",
          signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) break;
        data = await res.json();
      } catch {
        break;
      }
      const list = data.jobPostings || [];
      for (const j of list) {
        if (!j.externalPath || seen.has(j.externalPath)) continue;
        seen.add(j.externalPath);
        const days = workdayPostedDays(j.postedOn);
        out.push({
          title: j.title,
          url: `${base}/en-US/${site}${j.externalPath}`,
          location: j.locationsText || "",
          created: days == null ? null : new Date(Date.now() - days * 86400000).toISOString(),
          salaryMin: null,
          salaryMax: null,
          type: parseType(j.title),
          sector: null,
          skills: extractSkills(j.title),
        });
      }
      if (list.length < 20) break;
      if (pages === 1) break; // probe mode: one request is enough to confirm
    }
    if (pages === 1 && out.length) break;
  }
  return out;
}

const READERS = {
  greenhouse: readGreenhouse,
  lever: readLever,
  ashby: readAshby,
  recruitee: readRecruitee,
  smartrecruiters: readSmartRecruiters,
  workable: readWorkable,
  personio: readPersonio,
  workday: readWorkday,
};

// Read one board. Returns [] rather than throwing so one dead token can never
// take down a whole country's feed.
export async function readBoard(ats, token, opts) {
  const reader = READERS[ats];
  if (!reader || !token) return [];
  try {
    const jobs = await reader(token, opts);
    return jobs.filter((j) => j.title && j.url);
  } catch {
    return [];
  }
}

// Turn company slugs into the tokens a given ATS actually accepts. Everything
// except Workday keys off a bare slug.
export function tokenCandidates(ats, slugs) {
  if (ats !== "workday") return slugs;
  const out = [];
  // One slug only — the combinatorial explosion is in the datacenter × site
  // grid, so widening the slug list too would make a probe batch time out.
  const slug = slugs[0];
  if (!slug) return [];
  for (const dc of WD_DCS) for (const site of WD_SITES) out.push(`${slug}:${dc}:${site}`);
  return out;
}

// Ask every ATS whether a candidate slug resolves to a real board with real
// jobs. Only a board that actually returns postings is accepted — this is what
// keeps guessed tokens out of the database. Probing reads a single page per
// candidate; a board that answers at all is a board.
export async function probeBoard(candidates, only = ATS_TYPES) {
  for (const ats of only) {
    for (const token of tokenCandidates(ats, candidates)) {
      const jobs = await readBoard(ats, token, { pages: 1 });
      if (jobs.length > 0) return { ats, token, count: jobs.length };
    }
  }
  return null;
}

// Bounded-concurrency map — same helper the jobs route uses, kept local so this
// module stands alone.
export async function pool(items, limit, worker) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await worker(items[idx], idx).catch(() => null);
      }
    })
  );
  return out;
}
