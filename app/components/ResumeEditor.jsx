"use client";

import { useEffect, useRef, useState } from "react";
import ResumeTemplate from "./ResumeTemplate";
import { buildInitialData } from "../lib/resumeParse";
import { fileToHtml } from "../lib/resumeHtml";

export default function ResumeEditor({ open, onClose, onSaved, skills, user, pendingFile, resumeData, resumeText }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // "save" | "download" | null
  const [err, setErr] = useState(null);
  const [data, setData] = useState(null);
  const [accent, setAccent] = useState("#4f46e5");
  const [headingColor, setHeadingColor] = useState("#2aa6b0");
  const [photo, setPhoto] = useState("");
  const tplRef = useRef(null);

  // Build the initial structured data whenever the editor opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    (async () => {
      let text = resumeText || "";
      // A just-uploaded file (not yet saved) → extract its text for parsing.
      if (!resumeData && pendingFile) {
        try {
          const html = await fileToHtml(pendingFile);
          text = html.replace(/<[^>]+>/g, " ");
        } catch {}
      }
      const d = buildInitialData({ resumeData, resumeText: text, skills, user });
      if (cancelled) return;
      setAccent(d.accent || "#4f46e5");
      setHeadingColor(d.headingColor || "#2aa6b0");
      setPhoto(d.photo || "");
      setData(d);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, resumeData, pendingFile, resumeText, skills, user]);

  if (!open) return null;

  function collect() {
    const harvested = tplRef.current?.harvest?.() || {};
    return { ...harvested, accent, headingColor, photo };
  }

  async function renderWorker() {
    const html2pdf = (await import("html2pdf.js")).default;
    const node = tplRef.current.getRoot();
    return html2pdf()
      .set({
        margin: 0,
        filename: `${(collect().name || "resume").replace(/\s+/g, "_")}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "pt", format: "a4", orientation: "portrait" },
      })
      .from(node);
  }

  async function onDownload() {
    setBusy("download");
    setErr(null);
    try {
      await (await renderWorker()).save();
    } catch (e) {
      setErr("Couldn't generate the PDF: " + (e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function onReplace() {
    setBusy("save");
    setErr(null);
    try {
      const worker = await renderWorker();
      const blob = await worker.outputPdf("blob");
      const pdfB64 = await blobToBase64(blob);
      const res = await fetch("/api/profile/resume/html", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: collect(), pdfB64 }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Save failed");
      onSaved?.(json.resumeName);
      onClose?.();
    } catch (e) {
      setErr(e.message || "Couldn't save the résumé.");
    } finally {
      setBusy(null);
    }
  }

  const onPhoto = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setPhoto(String(r.result || ""));
    r.readAsDataURL(file);
  };

  const cmd = (c) => document.execCommand(c, false, null);

  return (
    <div className="modalOverlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modalCard">
        <div className="modalHead">
          <b>✏️ Edit résumé</b>
          <button className="modalX" onClick={onClose}>✕</button>
        </div>

        <div className="editorToolbar">
          <button type="button" className="tbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("bold")}>B</button>
          <button type="button" className="tbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("italic")}>I</button>
          <button type="button" className="tbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("insertUnorderedList")}>• List</button>
          <span className="tbSep" />
          <label className="tbColor">Accent <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} /></label>
          <label className="tbColor">Headings <input type="color" value={headingColor} onChange={(e) => setHeadingColor(e.target.value)} /></label>
          <label className="tbtn tbPhoto">
            Photo
            <input type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
          </label>
          {photo && <button type="button" className="tbtn" onClick={() => setPhoto("")}>Remove photo</button>}
        </div>

        <div className="editorScroll">
          {loading && <div className="editorLoading">Loading your résumé…</div>}
          {!loading && data && (
            <ResumeTemplate ref={tplRef} data={data} accent={accent} headingColor={headingColor} photo={photo} />
          )}
        </div>

        {err && <p className="autherr" style={{ padding: "0 16px" }}>{err}</p>}

        <div className="modalFoot">
          <span className="muted small">Content pulled from your résumé is a starting point — edit it here. Exports a styled PDF.</span>
          <div className="modalFootBtns">
            <button className="btn ghost" onClick={onClose} disabled={!!busy}>Cancel</button>
            <button className="btn ghost" onClick={onDownload} disabled={!!busy || loading}>
              {busy === "download" ? "Generating…" : "⬇ Download PDF"}
            </button>
            <button className="btn" onClick={onReplace} disabled={!!busy || loading}>
              {busy === "save" ? "Saving…" : "Replace saved résumé"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      resolve(s.includes(",") ? s.split(",")[1] : s);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
