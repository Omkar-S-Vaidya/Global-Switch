// Country-aware, categorized, live job aggregator.
//
// Global ATS boards (Greenhouse — public, no key) carry roles in every country,
// so the SAME company boards power Singapore, India, US, UK, Australia just by
// switching a location filter. Each country also has a curated list of local
// employers (banks, gov, local startups) shown with deep-search links.
//
// Why not Naukri / LinkedIn / Indeed / Glassdoor / Jobstreet? None expose an
// open/free job API (deprecated or partner-gated) and they block bots. The
// clean country-wise upgrade for full board coverage is Adzuna (free key,
// per-country) — easy to add on top of this.

import { extractSkills } from "../../lib/skills";
import { sql, ensureSchema } from "../../lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function stripHtml(s = "") {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .slice(0, 4000);
}

export const COUNTRIES = [
  { key: "singapore", label: "🇸🇬 Singapore", match: "singapore" },
  {
    key: "india",
    label: "🇮🇳 India",
    match:
      "india|bengaluru|bangalore|mumbai|new delhi|delhi|gurgaon|gurugram|hyderabad|pune|chennai|noida|kolkata|ahmedabad",
  },
  {
    key: "us",
    label: "🇺🇸 United States",
    match:
      "united states|\\bu\\.?s\\.?a?\\.?\\b|new york|san francisco|seattle|austin|boston|chicago|los angeles|remote - us|mountain view|menlo park|palo alto|sunnyvale|denver|atlanta|dallas|washington|, ca\\b|, ny\\b|, tx\\b|, wa\\b|, ma\\b|, il\\b|, co\\b|, ga\\b",
  },
  {
    key: "uk",
    label: "🇬🇧 United Kingdom",
    match:
      "united kingdom|\\bu\\.?k\\.?\\b|england|london|manchester|edinburgh|cambridge|bristol|leeds|glasgow|oxford",
  },
  {
    key: "australia",
    label: "🇦🇺 Australia",
    match: "australia|sydney|melbourne|brisbane|perth|canberra|adelaide",
  },
  {
    key: "canada",
    label: "🇨🇦 Canada",
    match:
      "canada|toronto|vancouver|montreal|ottawa|waterloo|calgary|mississauga|\\bon\\b, ca|, on\\b|, bc\\b|, qc\\b",
  },
  {
    key: "germany",
    label: "🇩🇪 Germany",
    match:
      "germany|berlin|munich|münchen|munchen|hamburg|frankfurt|cologne|köln|koln|stuttgart|düsseldorf|dusseldorf",
  },
  {
    key: "switzerland",
    label: "🇨🇭 Switzerland",
    match:
      "switzerland|suisse|schweiz|svizzera|\\bch\\b|zurich|zürich|zuerich|geneva|genève|geneve|genf|basel|bern|berne|lausanne|lucerne|luzern|\\bzug\\b|winterthur|st\\.? gallen|lugano|biel|bienne",
  },
  {
    key: "uae",
    label: "🇦🇪 UAE",
    match: "united arab emirates|\\buae\\b|dubai|abu dhabi|sharjah",
  },
  {
    key: "japan",
    label: "🇯🇵 Japan",
    match: "japan|tokyo|osaka|kyoto|yokohama|nagoya",
  },
];

export const CATEGORIES = [
  { key: "big-mnc", label: "Big MNC" },
  { key: "growing-mnc", label: "Growing MNC / Scale-up" },
  { key: "startup", label: "Startups" },
  { key: "bank-finance", label: "Banks & Finance" },
  { key: "gov-local", label: "Gov / Local / IT" },
  { key: "more-live", label: "More live roles" },
];

// Our country keys → Adzuna's country codes. Countries not listed here
// (UAE, Japan) simply keep Greenhouse-only coverage.
const ADZUNA_COUNTRY = {
  singapore: "sg",
  india: "in",
  us: "us",
  uk: "gb",
  australia: "au",
  canada: "ca",
  germany: "de",
  switzerland: "ch",
};

// Global Greenhouse boards: [ name, token, tier, sector ]. Live in every country.
const GH_COMPANIES = [
  ["Stripe", "stripe", "big-mnc", "Fintech"],
  ["Datadog", "datadog", "big-mnc", "Observability"],
  ["MongoDB", "mongodb", "big-mnc", "Databases"],
  ["Databricks", "databricks", "big-mnc", "Data / AI"],
  ["Adyen", "adyen", "big-mnc", "Fintech"],
  ["Agoda", "agoda", "big-mnc", "Travel Tech"],
  ["Airbnb", "airbnb", "big-mnc", "Travel Tech"],
  ["GitLab", "gitlab", "big-mnc", "DevTools"],
  ["Twilio", "twilio", "big-mnc", "SaaS"],
  ["Elastic", "elastic", "big-mnc", "Search / Data"],
  ["Okta", "okta", "big-mnc", "Identity / Security"],
  ["Pinterest", "pinterest", "big-mnc", "Social"],
  ["Reddit", "reddit", "big-mnc", "Social"],
  ["Flexport", "flexport", "big-mnc", "Logistics Tech"],
  ["Figma", "figma", "big-mnc", "Design SaaS"],
  ["OKX", "okx", "growing-mnc", "Crypto"],
  ["Coinbase", "coinbase", "growing-mnc", "Crypto"],
  ["Gemini", "gemini", "growing-mnc", "Crypto"],
  ["Bybit", "bybit", "growing-mnc", "Crypto"],
  ["Ripple", "ripple", "growing-mnc", "Crypto"],
  ["Fireblocks", "fireblocks", "growing-mnc", "Crypto Infra"],
  ["Thunes", "thunes", "growing-mnc", "Fintech"],
  ["Xendit", "xendit", "growing-mnc", "Fintech"],
  ["Anthropic", "anthropic", "growing-mnc", "AI"],
  // ---- discovered via auto-probe (Item 5) ----
  ["Postman", "postman", "startup", "DevTools"],
  ["PhonePe", "phonepe", "growing-mnc", "Fintech"],
  ["Vercel", "vercel", "startup", "DevTools"],
  ["Brex", "brex", "growing-mnc", "Fintech"],
  ["Scale AI", "scaleai", "growing-mnc", "AI"],
  ["Discord", "discord", "growing-mnc", "Social"],
  ["Robinhood", "robinhood", "growing-mnc", "Fintech"],
  ["Instacart", "instacart", "growing-mnc", "E-commerce"],
  ["Gusto", "gusto", "growing-mnc", "HR Tech"],
  ["Samsara", "samsara", "big-mnc", "IoT"],
  ["Airtable", "airtable", "startup", "SaaS"],
  ["Asana", "asana", "big-mnc", "SaaS"],
  ["Dropbox", "dropbox", "big-mnc", "SaaS"],
  ["Cloudflare", "cloudflare", "big-mnc", "Infra / Security"],
  ["Affirm", "affirm", "growing-mnc", "Fintech"],
  ["Chime", "chime", "growing-mnc", "Fintech"],
  ["Monzo", "monzo", "growing-mnc", "Fintech"],
  ["GoCardless", "gocardless", "growing-mnc", "Fintech"],
  ["N26", "n26", "growing-mnc", "Fintech"],
  ["Celonis", "celonis", "growing-mnc", "Process Mining"],
  ["GetYourGuide", "getyourguide", "growing-mnc", "Travel Tech"],
  ["HelloFresh", "hellofresh", "growing-mnc", "FoodTech"],
  ["Contentful", "contentful", "startup", "SaaS"],
  ["SumUp", "sumup", "growing-mnc", "Fintech"],
];

// Country-specific curated employers (no public ATS API) — deep-search links.
// [ name, tier, sector ]
const CURATED = {
  singapore: [
    ["Google", "big-mnc", "Big Tech"],
    ["Meta", "big-mnc", "Big Tech"],
    ["Amazon", "big-mnc", "Big Tech / Cloud"],
    ["Microsoft", "big-mnc", "Big Tech"],
    ["Apple", "big-mnc", "Big Tech"],
    ["Visa", "big-mnc", "Fintech"],
    ["TikTok / ByteDance", "big-mnc", "Big Tech"],
    ["Shopee (Sea)", "big-mnc", "E-commerce"],
    ["Grab", "growing-mnc", "Super-app"],
    ["Nium", "growing-mnc", "Fintech"],
    ["bolttech", "growing-mnc", "InsurTech"],
    ["Wise", "growing-mnc", "Fintech"],
    ["Airwallex", "growing-mnc", "Fintech"],
    ["Klook", "growing-mnc", "Travel Tech"],
    ["Razer", "growing-mnc", "Hardware / Gaming"],
    ["Ninja Van", "growing-mnc", "Logistics"],
    ["StashAway", "startup", "WealthTech"],
    ["Endowus", "startup", "WealthTech"],
    ["Carousell", "startup", "Marketplace"],
    ["Aspire", "startup", "Fintech"],
    ["ShopBack", "startup", "Fintech / E-commerce"],
    ["Sleek", "startup", "FinTech / SaaS"],
    ["PatSnap", "startup", "SaaS / AI"],
    ["Carro", "startup", "AutoTech"],
    ["DBS Bank", "bank-finance", "Banking"],
    ["OCBC Bank", "bank-finance", "Banking"],
    ["UOB", "bank-finance", "Banking"],
    ["Standard Chartered", "bank-finance", "Banking"],
    ["GIC", "bank-finance", "Sovereign Fund"],
    ["Great Eastern", "bank-finance", "Insurance"],
    ["GovTech Singapore", "gov-local", "Government Tech"],
    ["Singtel", "gov-local", "Telecom"],
    ["ST Engineering", "gov-local", "Engineering"],
    ["NCS", "gov-local", "IT Services"],
    ["Synapxe (IHiS)", "gov-local", "HealthTech"],
    ["PSA International", "gov-local", "Ports / Logistics"],
  ],
  india: [
    ["Google", "big-mnc", "Big Tech"],
    ["Microsoft", "big-mnc", "Big Tech"],
    ["Amazon", "big-mnc", "Big Tech / Cloud"],
    ["Walmart Global Tech", "big-mnc", "Retail Tech"],
    ["Adobe", "big-mnc", "SaaS"],
    ["PayPal", "big-mnc", "Fintech"],
    ["Uber", "big-mnc", "Mobility"],
    ["Cisco", "big-mnc", "Networking"],
    ["Qualcomm", "big-mnc", "Semiconductors"],
    ["SAP Labs India", "big-mnc", "Enterprise Software"],
    ["Flipkart", "growing-mnc", "E-commerce"],
    ["Swiggy", "growing-mnc", "FoodTech"],
    ["Zomato", "growing-mnc", "FoodTech"],
    ["PhonePe", "growing-mnc", "Fintech"],
    ["Razorpay", "growing-mnc", "Fintech"],
    ["CRED", "growing-mnc", "Fintech"],
    ["Meesho", "growing-mnc", "E-commerce"],
    ["Dream11", "growing-mnc", "Gaming"],
    ["Nykaa", "growing-mnc", "E-commerce"],
    ["Zerodha", "startup", "Fintech"],
    ["Groww", "startup", "WealthTech"],
    ["Postman", "startup", "DevTools"],
    ["BrowserStack", "startup", "DevTools"],
    ["Freshworks", "startup", "SaaS"],
    ["Zoho", "startup", "SaaS"],
    ["Hasura", "startup", "DevTools"],
    ["Slice", "startup", "Fintech"],
    ["HDFC Bank", "bank-finance", "Banking"],
    ["ICICI Bank", "bank-finance", "Banking"],
    ["Axis Bank", "bank-finance", "Banking"],
    ["Kotak Mahindra Bank", "bank-finance", "Banking"],
    ["Bajaj Finserv", "bank-finance", "Financial Services"],
    ["Goldman Sachs", "bank-finance", "Banking"],
    ["TCS", "gov-local", "IT Services"],
    ["Infosys", "gov-local", "IT Services"],
    ["Wipro", "gov-local", "IT Services"],
    ["HCLTech", "gov-local", "IT Services"],
    ["Tech Mahindra", "gov-local", "IT Services"],
    ["LTIMindtree", "gov-local", "IT Services"],
    ["Persistent Systems", "gov-local", "IT Services"],
  ],
  us: [
    ["Google", "big-mnc", "Big Tech"],
    ["Meta", "big-mnc", "Big Tech"],
    ["Amazon", "big-mnc", "Big Tech / Cloud"],
    ["Microsoft", "big-mnc", "Big Tech"],
    ["Apple", "big-mnc", "Big Tech"],
    ["Netflix", "big-mnc", "Streaming"],
    ["Nvidia", "big-mnc", "Semiconductors"],
    ["Adobe", "big-mnc", "SaaS"],
    ["Salesforce", "big-mnc", "SaaS"],
    ["Oracle", "big-mnc", "Enterprise Software"],
    ["Intel", "big-mnc", "Semiconductors"],
    ["PayPal", "big-mnc", "Fintech"],
    ["OpenAI", "growing-mnc", "AI"],
    ["Snowflake", "growing-mnc", "Data / Cloud"],
    ["Plaid", "growing-mnc", "Fintech"],
    ["Brex", "growing-mnc", "Fintech"],
    ["Ramp", "growing-mnc", "Fintech"],
    ["Notion", "growing-mnc", "SaaS"],
    ["Rippling", "growing-mnc", "HR Tech"],
    ["Scale AI", "growing-mnc", "AI"],
    ["Vercel", "startup", "DevTools"],
    ["Linear", "startup", "DevTools"],
    ["Retool", "startup", "DevTools"],
    ["Supabase", "startup", "DevTools"],
    ["Replit", "startup", "DevTools"],
    ["Perplexity", "startup", "AI"],
    ["Cursor (Anysphere)", "startup", "AI"],
    ["JPMorgan", "bank-finance", "Banking"],
    ["Goldman Sachs", "bank-finance", "Banking"],
    ["Morgan Stanley", "bank-finance", "Banking"],
    ["Citadel", "bank-finance", "Hedge Fund"],
    ["Two Sigma", "bank-finance", "Hedge Fund"],
    ["Jane Street", "bank-finance", "Trading"],
    ["Capital One", "bank-finance", "Banking"],
    ["USAJobs (Federal)", "gov-local", "Government"],
    ["NASA JPL", "gov-local", "Aerospace / Gov"],
    ["MITRE", "gov-local", "Gov / Research"],
  ],
  uk: [
    ["Google", "big-mnc", "Big Tech"],
    ["Meta", "big-mnc", "Big Tech"],
    ["Amazon", "big-mnc", "Big Tech / Cloud"],
    ["Microsoft", "big-mnc", "Big Tech"],
    ["Apple", "big-mnc", "Big Tech"],
    ["Bloomberg", "big-mnc", "FinTech / Media"],
    ["Palantir", "big-mnc", "Data / Defence"],
    ["Nvidia", "big-mnc", "Semiconductors"],
    ["Monzo", "growing-mnc", "Fintech"],
    ["Starling Bank", "growing-mnc", "Fintech"],
    ["Revolut", "growing-mnc", "Fintech"],
    ["Wise", "growing-mnc", "Fintech"],
    ["Deliveroo", "growing-mnc", "FoodTech"],
    ["Checkout.com", "growing-mnc", "Fintech"],
    ["Darktrace", "growing-mnc", "Cybersecurity"],
    ["GoCardless", "growing-mnc", "Fintech"],
    ["Snyk", "startup", "DevSecOps"],
    ["Improbable", "startup", "Metaverse / Tech"],
    ["Octopus Energy", "startup", "Energy Tech"],
    ["Onfido", "startup", "Identity"],
    ["Synthesia", "startup", "AI"],
    ["ElevenLabs", "startup", "AI"],
    ["HSBC", "bank-finance", "Banking"],
    ["Barclays", "bank-finance", "Banking"],
    ["Lloyds Banking Group", "bank-finance", "Banking"],
    ["NatWest", "bank-finance", "Banking"],
    ["Standard Chartered", "bank-finance", "Banking"],
    ["Schroders", "bank-finance", "Asset Management"],
    ["Government Digital Service", "gov-local", "Government"],
    ["BBC", "gov-local", "Media / Public"],
    ["NHS Digital", "gov-local", "HealthTech / Gov"],
  ],
  australia: [
    ["Google", "big-mnc", "Big Tech"],
    ["Amazon", "big-mnc", "Big Tech / Cloud"],
    ["Microsoft", "big-mnc", "Big Tech"],
    ["Atlassian", "big-mnc", "SaaS"],
    ["Canva", "big-mnc", "Design SaaS"],
    ["REA Group", "big-mnc", "PropTech"],
    ["SEEK", "big-mnc", "Job Marketplace"],
    ["Airwallex", "growing-mnc", "Fintech"],
    ["Block (Afterpay)", "growing-mnc", "Fintech"],
    ["Culture Amp", "growing-mnc", "HR Tech"],
    ["Employment Hero", "growing-mnc", "HR Tech"],
    ["SafetyCulture", "growing-mnc", "SaaS"],
    ["Linktree", "growing-mnc", "Creator Tech"],
    ["Immutable", "startup", "Web3 / Gaming"],
    ["Eucalyptus", "startup", "HealthTech"],
    ["Go1", "startup", "EdTech"],
    ["Pet Circle", "startup", "E-commerce"],
    ["Commonwealth Bank", "bank-finance", "Banking"],
    ["Westpac", "bank-finance", "Banking"],
    ["NAB", "bank-finance", "Banking"],
    ["ANZ", "bank-finance", "Banking"],
    ["Macquarie Group", "bank-finance", "Banking"],
    ["Australian Public Service", "gov-local", "Government"],
    ["CSIRO", "gov-local", "Research / Gov"],
    ["Telstra", "gov-local", "Telecom"],
    ["Optus", "gov-local", "Telecom"],
  ],
  canada: [
    ["Google", "big-mnc", "Big Tech"],
    ["Amazon", "big-mnc", "Big Tech / Cloud"],
    ["Microsoft", "big-mnc", "Big Tech"],
    ["Shopify", "big-mnc", "E-commerce"],
    ["Apple", "big-mnc", "Big Tech"],
    ["Nvidia", "big-mnc", "Semiconductors"],
    ["Wealthsimple", "growing-mnc", "WealthTech"],
    ["Cohere", "growing-mnc", "AI"],
    ["1Password", "growing-mnc", "Security"],
    ["Lightspeed", "growing-mnc", "Commerce"],
    ["Clio", "growing-mnc", "LegalTech"],
    ["Hootsuite", "growing-mnc", "SaaS"],
    ["Ada", "startup", "AI / Support"],
    ["Jobber", "startup", "SaaS"],
    ["ApplyBoard", "startup", "EdTech"],
    ["Vidyard", "startup", "Video SaaS"],
    ["RBC", "bank-finance", "Banking"],
    ["TD Bank", "bank-finance", "Banking"],
    ["Scotiabank", "bank-finance", "Banking"],
    ["BMO", "bank-finance", "Banking"],
    ["CIBC", "bank-finance", "Banking"],
    ["Government of Canada", "gov-local", "Government"],
    ["CBC/Radio-Canada", "gov-local", "Media / Public"],
    ["Telus", "gov-local", "Telecom"],
    ["Bell Canada", "gov-local", "Telecom"],
  ],
  germany: [
    ["Google", "big-mnc", "Big Tech"],
    ["Amazon", "big-mnc", "Big Tech / Cloud"],
    ["Microsoft", "big-mnc", "Big Tech"],
    ["SAP", "big-mnc", "Enterprise Software"],
    ["Siemens", "big-mnc", "Engineering"],
    ["Bosch", "big-mnc", "Engineering"],
    ["Zalando", "big-mnc", "E-commerce"],
    ["Trade Republic", "growing-mnc", "Fintech"],
    ["Personio", "growing-mnc", "HR Tech"],
    ["Delivery Hero", "growing-mnc", "FoodTech"],
    ["Wefox", "growing-mnc", "InsurTech"],
    ["Pitch", "startup", "SaaS"],
    ["Forto", "startup", "Logistics Tech"],
    ["sennder", "startup", "Logistics Tech"],
    ["Taxfix", "startup", "Fintech"],
    ["Tourlane", "startup", "Travel Tech"],
    ["Deutsche Bank", "bank-finance", "Banking"],
    ["Commerzbank", "bank-finance", "Banking"],
    ["Allianz", "bank-finance", "Insurance"],
    ["DZ Bank", "bank-finance", "Banking"],
    ["Deutsche Telekom", "gov-local", "Telecom"],
    ["Deutsche Bahn", "gov-local", "Rail / Public"],
    ["BMW Group", "gov-local", "Automotive"],
    ["Volkswagen", "gov-local", "Automotive"],
  ],
  switzerland: [
    ["Google", "big-mnc", "Big Tech"],
    ["Microsoft", "big-mnc", "Big Tech"],
    ["Amazon", "big-mnc", "Big Tech / Cloud"],
    ["Apple", "big-mnc", "Big Tech"],
    ["Meta", "big-mnc", "Big Tech"],
    ["IBM Research Zurich", "big-mnc", "Research / Tech"],
    ["Nestlé", "big-mnc", "FMCG"],
    ["Roche", "big-mnc", "Pharma / HealthTech"],
    ["Novartis", "big-mnc", "Pharma / HealthTech"],
    ["ABB", "big-mnc", "Industrial Tech"],
    ["Logitech", "growing-mnc", "Hardware"],
    ["Scandit", "growing-mnc", "Computer Vision"],
    ["Nexthink", "growing-mnc", "SaaS"],
    ["Frontify", "growing-mnc", "SaaS"],
    ["Beekeeper", "growing-mnc", "SaaS"],
    ["Ledgy", "startup", "Fintech"],
    ["Yokoy", "startup", "Fintech"],
    ["GetYourGuide", "startup", "Travel Tech"],
    ["Sonar", "startup", "DevTools"],
    ["UBS", "bank-finance", "Banking"],
    ["Credit Suisse", "bank-finance", "Banking"],
    ["Julius Baer", "bank-finance", "Private Banking"],
    ["Zürcher Kantonalbank", "bank-finance", "Banking"],
    ["Swiss Re", "bank-finance", "Reinsurance"],
    ["Zurich Insurance", "bank-finance", "Insurance"],
    ["ETH Zurich", "gov-local", "University / Research"],
    ["EPFL", "gov-local", "University / Research"],
    ["Swisscom", "gov-local", "Telecom"],
    ["SBB CFF FFS", "gov-local", "Rail / Public"],
    ["Swiss Post", "gov-local", "Public / Logistics"],
  ],
  uae: [
    ["Google", "big-mnc", "Big Tech"],
    ["Amazon", "big-mnc", "Big Tech / Cloud"],
    ["Microsoft", "big-mnc", "Big Tech"],
    ["IBM", "big-mnc", "Enterprise Tech"],
    ["Oracle", "big-mnc", "Enterprise Software"],
    ["SAP", "big-mnc", "Enterprise Software"],
    ["Careem", "growing-mnc", "Super-app"],
    ["Talabat", "growing-mnc", "FoodTech"],
    ["Noon", "growing-mnc", "E-commerce"],
    ["Kitopi", "growing-mnc", "FoodTech"],
    ["Property Finder", "growing-mnc", "PropTech"],
    ["Tabby", "growing-mnc", "Fintech"],
    ["Bayut / dubizzle", "startup", "Classifieds"],
    ["Huspy", "startup", "PropTech"],
    ["Lean Technologies", "startup", "Fintech"],
    ["Sarwa", "startup", "WealthTech"],
    ["Emirates NBD", "bank-finance", "Banking"],
    ["First Abu Dhabi Bank", "bank-finance", "Banking"],
    ["Mashreq", "bank-finance", "Banking"],
    ["ADCB", "bank-finance", "Banking"],
    ["e& (Etisalat)", "gov-local", "Telecom"],
    ["du", "gov-local", "Telecom"],
    ["ADNOC", "gov-local", "Energy"],
    ["Dubai Holding", "gov-local", "Conglomerate"],
  ],
  japan: [
    ["Google", "big-mnc", "Big Tech"],
    ["Amazon", "big-mnc", "Big Tech / Cloud"],
    ["Microsoft", "big-mnc", "Big Tech"],
    ["Rakuten", "big-mnc", "E-commerce"],
    ["Sony", "big-mnc", "Electronics"],
    ["LINE Yahoo", "big-mnc", "Internet"],
    ["Mercari", "growing-mnc", "Marketplace"],
    ["PayPay", "growing-mnc", "Fintech"],
    ["SmartNews", "growing-mnc", "Media"],
    ["Woven by Toyota", "growing-mnc", "Mobility / AI"],
    ["Sansan", "growing-mnc", "SaaS"],
    ["SmartHR", "startup", "HR Tech"],
    ["Money Forward", "startup", "Fintech"],
    ["Andpad", "startup", "ConTech"],
    ["Kakehashi", "startup", "HealthTech"],
    ["MUFG", "bank-finance", "Banking"],
    ["Mizuho", "bank-finance", "Banking"],
    ["SMBC", "bank-finance", "Banking"],
    ["Nomura", "bank-finance", "Banking"],
    ["NTT", "gov-local", "Telecom"],
    ["SoftBank", "gov-local", "Telecom"],
    ["KDDI", "gov-local", "Telecom"],
    ["Fujitsu", "gov-local", "IT Services"],
  ],
};

const ENG =
  /(engineer|developer|software|backend|back-end|frontend|front-end|full.?stack|data|devops|platform|mobile|ios|android|\bsre\b|machine learning|\bml\b|infrastructure|security|\bqa\b|sdet|architect|programmer)/i;

// Infer experience level + job type from a role title (Greenhouse has no field
// for these). Buckets used by the UI filters.
function parseExp(t = "") {
  if (/\bintern(ship)?\b|\btrainee\b|new grad|graduate program|\bcampus\b|\bapprentice\b/i.test(t))
    return "intern";
  if (/principal|\bstaff\b|\blead\b|head of|\bdirector\b|distinguished|\bvp\b|\bfellow\b/i.test(t))
    return "lead";
  if (/\bsenior\b|\bsr\.?\b/i.test(t)) return "senior";
  if (/\bjunior\b|\bjr\.?\b|\bassociate\b|entry.level|\bgraduate\b/i.test(t)) return "junior";
  return "mid";
}
function parseType(t = "") {
  if (/\bintern(ship)?\b/i.test(t)) return "internship";
  if (/contract|contractor|temporary|fixed.?term|freelance|c2c/i.test(t)) return "contract";
  if (/part.?time/i.test(t)) return "parttime";
  return "fulltime";
}

function linkedinUrl(company, countryName) {
  const q = encodeURIComponent(`${company} software developer`);
  return `https://www.linkedin.com/jobs/search/?keywords=${q}&location=${encodeURIComponent(
    countryName
  )}`;
}
function careersUrl(company, countryName) {
  const q = encodeURIComponent(`${company} careers software engineer ${countryName}`);
  return `https://www.google.com/search?q=${q}`;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "JobHuntCommandCenter/1.0", Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function pool(items, limit, worker) {
  const out = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx]).catch(() => null);
    }
  });
  await Promise.all(runners);
  return out;
}

// Cache raw (eng-filtered) Greenhouse jobs per token so switching country is free.
let RAW = { ts: 0, map: null };
const TTL = 10 * 60 * 1000;

async function rawGreenhouse() {
  if (RAW.map && Date.now() - RAW.ts < TTL) return RAW.map;
  const results = await pool(GH_COMPANIES, 8, async ([name, token]) => {
    // content=true returns full descriptions so we can extract skills server-side.
    const data = await getJson(
      `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`
    );
    const jobs = (data.jobs || [])
      .filter((j) => ENG.test(j.title || ""))
      .map((j) => {
        const text = (j.title || "") + " " + stripHtml(j.content || "");
        return {
          title: j.title,
          location: j.location?.name || "",
          url: j.absolute_url,
          updated_at: j.updated_at || null,
          skills: extractSkills(text), // skill keys only — description discarded
        };
      });
    return [name, { token, jobs }];
  });
  const map = new Map(results.filter(Boolean));
  RAW = { ts: Date.now(), map };
  return map;
}

// ---- Adzuna aggregator (optional; enabled when ADZUNA_APP_ID/KEY are set) ----
const ADZUNA_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_KEY = process.env.ADZUNA_APP_KEY;
const adzunaEnabled = (key) => !!(ADZUNA_ID && ADZUNA_KEY && ADZUNA_COUNTRY[key]);

const ADZUNA_CACHE = new Map(); // countryKey -> { ts, jobs }
const ADZUNA_TTL = 10 * 60 * 1000;

function adzunaType(j) {
  const t = j.title || "";
  if (/\bintern(ship)?\b/i.test(t)) return "internship";
  if (j.contract_type === "contract") return "contract";
  if (j.contract_time === "part_time") return "parttime";
  return parseType(t);
}

// Pull IT/engineering roles for a country straight from Adzuna. Cached per
// country; returns [] (never throws) when disabled or on error.
async function fetchAdzuna(countryKey) {
  if (!adzunaEnabled(countryKey)) return [];
  const cached = ADZUNA_CACHE.get(countryKey);
  if (cached && Date.now() - cached.ts < ADZUNA_TTL) return cached.jobs;

  const code = ADZUNA_COUNTRY[countryKey];
  const auth = `app_id=${ADZUNA_ID}&app_key=${ADZUNA_KEY}`;
  const out = [];
  for (const page of [1, 2]) {
    const url = `https://api.adzuna.com/v1/api/jobs/${code}/search/${page}?${auth}&results_per_page=50&category=it-jobs`;
    let data;
    try {
      data = await getJson(url);
    } catch {
      break;
    }
    const results = data.results || [];
    for (const j of results) {
      if (!ENG.test(j.title || "")) continue;
      const text = (j.title || "") + " " + stripHtml(j.description || "");
      out.push({
        company: (j.company?.display_name || "").trim() || "Employer (via Adzuna)",
        title: j.title,
        url: j.redirect_url,
        location: j.location?.display_name || "",
        created: j.created || null,
        salaryMin: j.salary_min ?? null,
        salaryMax: j.salary_max ?? null,
        type: adzunaType({ title: j.title, contract_type: j.contract_type, contract_time: j.contract_time }),
        sector: (j.category?.label || "IT").replace(/\s*jobs$/i, "").trim() || "IT",
        skills: extractSkills(text),
      });
    }
    if (results.length < 50) break; // last page reached
  }
  ADZUNA_CACHE.set(countryKey, { ts: Date.now(), jobs: out });
  return out;
}

// ---- Additional country-specific sources ----
// Each fetch* returns a flat list of normalized jobs:
//   { company, title, url, location, created, salaryMin, salaryMax, type, sector, skills }
// and never throws (returns [] on error).

const SRC_CACHE = new Map(); // key -> { ts, jobs }
const SRC_TTL = 10 * 60 * 1000;
async function withCache(key, fn) {
  const c = SRC_CACHE.get(key);
  if (c && Date.now() - c.ts < SRC_TTL) return c.jobs;
  const jobs = await fn().catch(() => []);
  SRC_CACHE.set(key, { ts: Date.now(), jobs });
  return jobs;
}

function titleCase(s = "") {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bPte\b/gi, "Pte")
    .trim();
}

// Group a source's flat job list by employer and merge into `byName`. Known
// companies gain the new roles (deduped by URL); the rest appear under the
// "More live roles" tier tagged with the source platform.
function groupAndMerge(byName, jobs, platform, countryName) {
  const grouped = new Map();
  for (const j of jobs) {
    if (!grouped.has(j.company)) grouped.set(j.company, []);
    grouped.get(j.company).push(j);
  }
  for (const [name, list] of grouped) {
    list.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));
    const roles = list.slice(0, 60).map((j) => ({
      title: j.title,
      url: j.url,
      location: j.location,
      exp: parseExp(j.title),
      type: j.type || parseType(j.title),
      skills: j.skills || [],
      salaryMin: j.salaryMin ?? null,
      salaryMax: j.salaryMax ?? null,
      updatedAt: j.created || null,
    }));
    const existing = byName.get(name);
    if (existing) {
      const seen = new Set(existing.roles.map((r) => r.url));
      for (const r of roles) if (!seen.has(r.url)) existing.roles.push(r);
      existing.openRoles = existing.roles.length;
    } else {
      byName.set(name, {
        company: name,
        category: "more-live",
        sector: list[0].sector || "Various",
        openRoles: list.length,
        roles,
        role: list[0].title,
        location: list[0].location || countryName,
        platform,
        platformUrl: list[0].url,
        boardUrl: null,
        linkedinUrl: linkedinUrl(name, countryName),
        careersUrl: careersUrl(name, countryName),
        updatedAt: list[0].created || null,
        live: true,
      });
    }
  }
}

// Singapore — MyCareersFuture (gov, public, no key). Rich data (skills, salary).
function mcfType(j) {
  const t = (j.employmentTypes || []).map((e) => e.employmentType || "").join(" ").toLowerCase();
  if (/intern|trainee/.test(t)) return "internship";
  if (/contract|temp/.test(t)) return "contract";
  if (/part/.test(t)) return "parttime";
  return "fulltime";
}
async function fetchMyCareersFuture() {
  const out = [];
  for (const page of [0, 1]) {
    const res = await fetch(`https://api.mycareersfuture.gov.sg/v2/search?limit=100&page=${page}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ search: "software engineer developer", sortBy: ["new_posting_date"] }),
      cache: "no-store",
    });
    if (!res.ok) break;
    const data = await res.json();
    const results = data.results || [];
    for (const j of results) {
      if (!ENG.test(j.title || "")) continue;
      const skillText = (j.skills || []).map((s) => s.skill).join(" ");
      const cats = (j.categories || []).map((c) => c.category).join(" ");
      const sal = j.salary || {};
      out.push({
        company: titleCase(j.postedCompany?.name || j.hiringCompany?.name || "Employer (via MyCareersFuture)"),
        title: j.title,
        url: `https://www.mycareersfuture.gov.sg/job/${j.uuid}`,
        location: [j.address?.building, "Singapore"].filter(Boolean).slice(-1)[0] || "Singapore",
        created: j.metadata?.newPostingDate || j.metadata?.updatedAt || null,
        salaryMin: sal.minimum ?? null,
        salaryMax: sal.maximum ?? null,
        type: mcfType(j),
        sector: j.categories?.[0]?.category || "Various",
        skills: extractSkills(`${j.title} ${skillText} ${cats}`),
      });
    }
    if (results.length < 100) break;
  }
  return out;
}

// Germany — Bundesagentur für Arbeit "Jobsuche" (public, well-known static key).
async function fetchArbeitsagentur() {
  const out = [];
  for (const page of [1, 2]) {
    const res = await fetch(
      `https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/app/jobs?was=${encodeURIComponent(
        "Softwareentwickler"
      )}&size=100&page=${page}`,
      { headers: { "X-API-Key": "jobboerse-jobsuche", Accept: "application/json" }, cache: "no-store" }
    );
    if (!res.ok) break;
    const data = await res.json();
    const arr = data.stellenangebote || [];
    for (const j of arr) {
      const title = j.titel || j.beruf || "";
      if (!title) continue;
      const ort = j.arbeitsort || {};
      out.push({
        company: (j.arbeitgeber || "Arbeitgeber").trim(),
        title,
        url: `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(j.refnr)}`,
        location: [ort.ort, ort.region].filter(Boolean).join(", ") || "Deutschland",
        created: j.aktuelleVeroeffentlichungsdatum || null,
        salaryMin: null,
        salaryMax: null,
        type: parseType(title),
        sector: "IT",
        skills: extractSkills(title),
      });
    }
    if (arr.length < 100) break;
  }
  return out;
}

// US — USAJOBS (federal, free self-service key). Enabled when env keys are set.
const USAJOBS_KEY = process.env.USAJOBS_API_KEY;
const USAJOBS_EMAIL = process.env.USAJOBS_EMAIL;
const usajobsEnabled = () => !!(USAJOBS_KEY && USAJOBS_EMAIL);
async function fetchUSAJobs() {
  if (!usajobsEnabled()) return [];
  const res = await fetch(
    "https://data.usajobs.gov/api/search?Keyword=software%20engineer&ResultsPerPage=100",
    {
      headers: {
        "User-Agent": USAJOBS_EMAIL,
        "Authorization-Key": USAJOBS_KEY,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const items = data.SearchResult?.SearchResultItems || [];
  const out = [];
  for (const it of items) {
    const d = it.MatchedObjectDescriptor || {};
    const title = d.PositionTitle || "";
    if (!ENG.test(title)) continue;
    const rem = (d.PositionRemuneration || [])[0] || {};
    const qual = d.QualificationSummary || d.UserArea?.Details?.JobSummary || "";
    out.push({
      company: d.OrganizationName || "US Federal Agency",
      title,
      url: d.PositionURI,
      location: d.PositionLocationDisplay || "United States",
      created: d.PublicationStartDate || null,
      salaryMin: rem.MinimumRange ? Number(rem.MinimumRange) : null,
      salaryMax: rem.MaximumRange ? Number(rem.MaximumRange) : null,
      type: parseType(title),
      sector: (d.JobCategory || [])[0]?.Name || "Government",
      skills: extractSkills(`${title} ${qual}`),
    });
  }
  return out;
}

// UK — Reed.co.uk jobseeker API (free key, HTTP Basic with key as username).
const REED_KEY = process.env.REED_API_KEY;
const reedEnabled = () => !!REED_KEY;
async function fetchReed() {
  if (!reedEnabled()) return [];
  const auth = "Basic " + Buffer.from(`${REED_KEY}:`).toString("base64");
  const out = [];
  for (const skip of [0, 100]) {
    const res = await fetch(
      `https://www.reed.co.uk/api/1.0/search?keywords=software%20developer&resultsToTake=100&resultsToSkip=${skip}`,
      { headers: { Authorization: auth, Accept: "application/json" }, cache: "no-store" }
    );
    if (!res.ok) break;
    const data = await res.json();
    const arr = data.results || [];
    for (const j of arr) {
      const title = j.jobTitle || "";
      if (!ENG.test(title)) continue;
      out.push({
        company: (j.employerName || "Employer").trim(),
        title,
        url: j.jobUrl || `https://www.reed.co.uk/jobs/${j.jobId}`,
        location: j.locationName || "United Kingdom",
        created: null,
        salaryMin: j.minimumSalary ?? null,
        salaryMax: j.maximumSalary ?? null,
        type: parseType(title),
        sector: "Various",
        skills: extractSkills(`${title} ${j.jobDescription || ""}`),
      });
    }
    if (arr.length < 100) break;
  }
  return out;
}

// Jooble aggregator (free key on request). Covers ~70 countries incl. UAE &
// Japan — used to fill countries without a dedicated local source.
const JOOBLE_KEY = process.env.JOOBLE_API_KEY;
const joobleEnabled = () => !!JOOBLE_KEY;
function joobleType(t = "") {
  const s = t.toLowerCase();
  if (/intern/.test(s)) return "internship";
  if (/part/.test(s)) return "parttime";
  if (/contract|temporary/.test(s)) return "contract";
  return "fulltime";
}
async function fetchJooble(countryName) {
  if (!joobleEnabled()) return [];
  const res = await fetch(`https://jooble.org/api/${JOOBLE_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ keywords: "software developer engineer", location: countryName }),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  const out = [];
  for (const j of data.jobs || []) {
    const title = j.title || "";
    if (!ENG.test(title)) continue;
    out.push({
      company: (j.company || "").trim() || "Employer (via Jooble)",
      title,
      url: j.link,
      location: j.location || countryName,
      created: j.updated || null,
      salaryMin: null,
      salaryMax: null,
      type: joobleType(j.type),
      sector: "Various",
      skills: extractSkills(`${title} ${j.snippet || ""}`),
    });
  }
  return out;
}

// Database-backed cache for Jooble to respect its 500-request cap. Serves from
// Neon when the stored result is < 12h old (survives serverless cold starts);
// only calls Jooble when the cache is stale. Falls back to a direct fetch if the
// DB is unavailable.
const JOOBLE_DB_TTL_MS = 12 * 60 * 60 * 1000;
async function joobleCached(countryKey, countryName) {
  try {
    await ensureSchema();
    const rows = await sql`
      SELECT payload, fetched_at FROM source_cache
      WHERE source = 'jooble' AND country = ${countryKey}
    `;
    const row = rows[0];
    if (row && Date.now() - new Date(row.fetched_at).getTime() < JOOBLE_DB_TTL_MS) {
      return row.payload || [];
    }
    const jobs = await fetchJooble(countryName);
    if (jobs.length) {
      await sql`
        INSERT INTO source_cache (source, country, payload, fetched_at)
        VALUES ('jooble', ${countryKey}, ${JSON.stringify(jobs)}::jsonb, now())
        ON CONFLICT (source, country) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()
      `;
    }
    return jobs;
  } catch {
    return fetchJooble(countryName).catch(() => []);
  }
}

// Dispatch all extra live sources applicable to a country. Runs them in
// parallel; each is cached and degrades to [] independently.
async function fetchExtraSources(countryKey, countryName) {
  const collected = [];
  const add = (platform, list) => list.length && collected.push({ platform, list });
  const tasks = [];
  if (adzunaEnabled(countryKey))
    tasks.push(fetchAdzuna(countryKey).then((l) => add("Adzuna", l)));
  if (countryKey === "singapore")
    tasks.push(withCache("mcf", fetchMyCareersFuture).then((l) => add("MyCareersFuture", l)));
  if (countryKey === "germany")
    tasks.push(withCache("arbeitsagentur", fetchArbeitsagentur).then((l) => add("Arbeitsagentur", l)));
  if (countryKey === "us" && usajobsEnabled())
    tasks.push(withCache("usajobs", fetchUSAJobs).then((l) => add("USAJOBS", l)));
  if (countryKey === "uk" && reedEnabled())
    tasks.push(withCache("reed", fetchReed).then((l) => add("Reed", l)));
  // Jooble fills countries that have no dedicated local API (DB-cached to
  // respect its 500-request quota).
  if ((countryKey === "uae" || countryKey === "japan") && joobleEnabled())
    tasks.push(
      withCache(`jooble:${countryKey}`, () => joobleCached(countryKey, countryName)).then((l) => add("Jooble", l))
    );
  await Promise.allSettled(tasks);
  return collected;
}

export async function GET(request) {
  const url = new URL(request.url);
  const countryKey = url.searchParams.get("country") || "singapore";
  const country = COUNTRIES.find((c) => c.key === countryKey) || COUNTRIES[0];
  const countryName = country.label.replace(/^[^\w]+/, "").trim();
  const matcher = new RegExp(country.match, "i");

  // Fetch Greenhouse + all applicable extra sources concurrently; each degrades
  // to empty independently on failure.
  const [raw, extras] = await Promise.all([
    rawGreenhouse().catch(() => new Map()),
    fetchExtraSources(country.key, countryName).catch(() => []),
  ]);

  const byName = new Map();

  // 1) Global Greenhouse companies, filtered to the selected country (live).
  for (const [name, , tier, sector] of GH_COMPANIES) {
    const rec = raw.get(name);
    const sg = (rec?.jobs || []).filter((j) => matcher.test(j.location));
    if (!sg.length) continue; // only surface a global board where it hires in this country
    sg.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    const roles = sg.slice(0, 60).map((j) => ({
      title: j.title,
      url: j.url,
      location: j.location,
      exp: parseExp(j.title),
      type: parseType(j.title),
      skills: j.skills || [],
      salaryMin: null,
      salaryMax: null,
      updatedAt: j.updated_at || null,
    }));
    byName.set(name, {
      company: name,
      category: tier,
      sector,
      openRoles: sg.length,
      roles,
      role: sg[0].title,
      location: sg[0].location || countryName,
      platform: "Greenhouse",
      platformUrl: sg[0].url,
      boardUrl: rec?.token
        ? `https://boards.greenhouse.io/${rec.token}`
        : careersUrl(name, countryName),
      linkedinUrl: linkedinUrl(name, countryName),
      careersUrl: careersUrl(name, countryName),
      updatedAt: sg[0].updated_at || null,
      live: true,
    });
  }

  // 2) Merge every extra source (Adzuna + country-specific gov/board APIs).
  const usedSources = [];
  for (const { platform, list } of extras) {
    groupAndMerge(byName, list, platform, countryName);
    usedSources.push(platform);
  }

  const companies = Array.from(byName.values());
  const liveCount = companies.filter((c) => c.live).length;
  const totalOpenRoles = companies.reduce((s, c) => s + c.openRoles, 0);

  const counts = {};
  for (const cat of CATEGORIES) {
    const list = companies.filter((c) => c.category === cat.key);
    counts[cat.key] = {
      total: list.length,
      hiring: list.filter((c) => c.openRoles > 0).length,
    };
  }

  return Response.json({
    ok: true,
    date: new Date().toISOString().slice(0, 10),
    country: country.key,
    countries: COUNTRIES.map(({ key, label }) => ({ key, label })),
    categories: CATEGORIES,
    counts,
    liveCount,
    totalOpenRoles,
    source: `${[...usedSources, "Greenhouse"].join(" + ")} live — ${liveCount} hiring, ${totalOpenRoles} open ${countryName} roles`,
    companies,
  });
}
