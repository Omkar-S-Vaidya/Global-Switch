// Best-effort parsing of extracted résumé text into the structured shape the
// styled template uses. Text from a PDF is imperfect (two columns interleave),
// so this is a starting point the user tidies in the editor.
import { skillLabel } from "./skills";

const DEFAULTS = { accent: "#4f46e5", headingColor: "#2aa6b0" };

function esc(s = "") {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function extractContact(text = "") {
  const email = (text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i) || [""])[0];
  const linkedin = (text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s)]+/i) || [""])[0];
  const phone = (text.match(/\+?\d[\d\s().-]{7,}\d/) || [""])[0].trim();
  return { email, phone, linkedin };
}

// Split résumé text into sections keyed by common headings. Returns a map of
// { experience, skills, courses, achievements, other } with raw text blocks.
const HEADINGS = [
  ["experience", /\b(work experience|professional experience|experience|employment)\b/i],
  ["skills", /\b(technical skills|skills|technologies|core competenc)/i],
  ["courses", /\b(courses?|certificat)/i],
  ["achievements", /\b(achievements?|accomplishments?|awards?)\b/i],
  ["education", /\b(education|academics?)\b/i],
  ["projects", /\b(projects?)\b/i],
];

function splitSections(text = "") {
  const lines = text.split(/\n|(?<=\.)\s{2,}/).map((l) => l.trim());
  const out = {};
  let current = "summary";
  out[current] = [];
  for (const line of lines) {
    if (!line) continue;
    const short = line.length < 40;
    const hit = short && HEADINGS.find(([, re]) => re.test(line));
    if (hit) {
      current = hit[0];
      if (!out[current]) out[current] = [];
      continue;
    }
    (out[current] = out[current] || []).push(line);
  }
  return out;
}

function paras(arr = []) {
  return arr.filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join("") || "";
}

export function skillsToHtml(skillKeys = []) {
  if (!skillKeys.length) return "";
  return `<p>${skillKeys.map((k) => esc(skillLabel(k))).join(" &middot; ")}</p>`;
}

// Build the initial structured data for the template editor.
export function buildInitialData({ resumeData, resumeText, skills = [], user } = {}) {
  if (resumeData && typeof resumeData === "object") {
    return { ...DEFAULTS, ...resumeData, contact: { ...(resumeData.contact || {}) } };
  }

  const text = (resumeText || "").replace(/\r/g, "");
  const contact = extractContact(text);
  const sec = splitSections(text);

  // Name / title heuristics: first non-empty lines that aren't contact info.
  const topLines = (sec.summary || []).filter(
    (l) => l && !/@|linkedin\.com|\+?\d[\d\s().-]{7,}/.test(l)
  );
  const name = (user?.name || topLines[0] || "Your Name").slice(0, 80);
  const title = (topLines[1] || "").slice(0, 100);
  const summaryLines = topLines.slice(2);

  return {
    ...DEFAULTS,
    photo: "",
    name,
    title,
    summary: summaryLines.join(" ").slice(0, 800),
    contact: {
      email: contact.email || user?.email || "",
      phone: contact.phone || "",
      linkedin: contact.linkedin || "",
    },
    experienceHtml: paras([...(sec.experience || []), ...(sec.projects || []), ...(sec.education || [])]),
    skillsHtml: skillsToHtml(skills) || paras(sec.skills || []),
    coursesHtml: paras(sec.courses || []),
    achievementsHtml: paras(sec.achievements || []),
  };
}
