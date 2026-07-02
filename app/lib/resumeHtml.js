// Client-side helpers to turn a résumé into editable HTML for the in-browser
// editor. DOCX keeps its structure (mammoth); PDF is text-only (layout is lost).
import { skillLabel } from "./skills";

function escapeHtml(s = "") {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// DOCX → HTML via mammoth (good fidelity: headings, lists, bold/italic).
async function docxToHtml(file) {
  const mod = await import("mammoth/mammoth.browser.js");
  const mammoth = mod.default || mod;
  const arrayBuffer = await file.arrayBuffer();
  const res = await mammoth.convertToHtml({ arrayBuffer });
  return res.value || "";
}

// PDF → HTML: extract text with pdfjs and rebuild rough paragraphs. Note that
// the original visual layout cannot be recovered from a PDF — this is text only.
async function pdfToHtml(file) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const paras = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = "";
    let lastY = null;
    for (const it of content.items) {
      const y = it.transform?.[5];
      // New visual line when the vertical position jumps.
      if (lastY !== null && Math.abs(y - lastY) > 4) {
        if (line.trim()) paras.push(line.trim());
        line = "";
      }
      line += it.str + (it.hasEOL ? " " : "");
      lastY = y;
    }
    if (line.trim()) paras.push(line.trim());
  }
  return paras.map((t) => `<p>${escapeHtml(t)}</p>`).join("");
}

function textToHtml(text = "") {
  return text
    .split(/\n{1,}/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `<p>${escapeHtml(t)}</p>`)
    .join("") || "<p></p>";
}

// An editable "Skills" block seeded from the user's current profile skills.
export function skillsSectionHtml(skillKeys = []) {
  if (!skillKeys.length) return "";
  const labels = skillKeys.map(skillLabel).join(" · ");
  return `<h2>Skills</h2><p>${escapeHtml(labels)}</p>`;
}

// Convert a freshly-picked File (DOCX / PDF / txt) to HTML.
export async function fileToHtml(file) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".docx")) return docxToHtml(file);
  if (name.endsWith(".pdf")) return pdfToHtml(file);
  return textToHtml(await file.text());
}

// Decide the initial editor HTML. Precedence:
//   saved resume_html  →  just-uploaded file  →  plain resume_text  →  empty.
// The seeded Skills block is appended only when the source has no "skills"
// heading yet, so we don't duplicate it on re-edits.
export async function resolveInitialHtml({ resumeHtml, pendingFile, resumeText, skillKeys }) {
  if (resumeHtml && resumeHtml.trim()) return resumeHtml;

  let base = "";
  if (pendingFile) {
    try {
      base = await fileToHtml(pendingFile);
    } catch {
      base = "";
    }
  }
  if (!base) base = textToHtml(resumeText || "");

  const hasSkills = /skills/i.test(base);
  return hasSkills ? base : base + skillsSectionHtml(skillKeys);
}
