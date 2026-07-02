// Client-side resume text extraction. Runs entirely in the browser — the file
// is never uploaded. PDF via pdfjs-dist, DOCX via mammoth, plus plain text.
export async function parseResumeFile(file) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".pdf")) return parsePdf(file);
  if (name.endsWith(".docx")) return parseDocx(file);
  return file.text();
}

async function parsePdf(file) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    text += " " + content.items.map((i) => i.str).join(" ");
  }
  return text;
}

async function parseDocx(file) {
  const mod = await import("mammoth/mammoth.browser.js");
  const mammoth = mod.default || mod;
  const arrayBuffer = await file.arrayBuffer();
  const res = await mammoth.extractRawText({ arrayBuffer });
  return res.value;
}
