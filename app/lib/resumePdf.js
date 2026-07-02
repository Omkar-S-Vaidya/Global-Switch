// Append a clean "Skills" page to an existing PDF resume, preserving the
// original pages untouched. Pure-JS (pdf-lib) so it runs in the Node route.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { skillLabel } from "./skills";

const A4 = [595.28, 841.89];
const M = 56; // page margin

function wrap(text, font, size, maxW) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// origBase64: the pristine resume PDF (base64). skillKeys: profile skill keys.
// Returns the updated PDF as base64.
export async function appendSkillsPage(origBase64, skillKeys) {
  const doc = await PDFDocument.load(Buffer.from(origBase64, "base64"), {
    ignoreEncryption: true,
  });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const labels = skillKeys.map(skillLabel);

  let page = doc.addPage(A4);
  const width = page.getSize().width;
  let y = page.getSize().height - M;

  page.drawText("Skills", { x: M, y, size: 22, font: bold, color: rgb(0.1, 0.13, 0.2) });
  y -= 17;
  page.drawText("Updated via JobHunt", { x: M, y, size: 9, font, color: rgb(0.5, 0.52, 0.6) });
  y -= 18;
  page.drawLine({
    start: { x: M, y },
    end: { x: width - M, y },
    thickness: 1,
    color: rgb(0.85, 0.87, 0.92),
  });
  y -= 26;

  const size = 12;
  const lineH = 20;
  const maxW = width - M * 2;
  const lines = wrap(labels.join("   •   "), font, size, maxW);
  for (const ln of lines) {
    if (y < M) {
      page = doc.addPage(A4);
      y = page.getSize().height - M;
    }
    page.drawText(ln, { x: M, y, size, font, color: rgb(0.16, 0.19, 0.26) });
    y -= lineH;
  }

  const bytes = await doc.save();
  return Buffer.from(bytes).toString("base64");
}
