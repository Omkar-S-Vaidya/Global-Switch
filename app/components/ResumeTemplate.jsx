"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

// A styled, edit-in-place two-column résumé. Editable regions are uncontrolled
// (initialised once from `data`, harvested on save) so the caret stays stable
// under React. Colours/photo are driven by props and never touch the editable
// DOM. Exposes { getRoot, harvest } via ref for PDF export + saving.
const ResumeTemplate = forwardRef(function ResumeTemplate(
  { data, accent, headingColor, photo },
  ref
) {
  const rootRef = useRef(null);
  const nameR = useRef(null);
  const titleR = useRef(null);
  const summaryR = useRef(null);
  const emailR = useRef(null);
  const phoneR = useRef(null);
  const linkedinR = useRef(null);
  const expR = useRef(null);
  const skillsR = useRef(null);
  const coursesR = useRef(null);
  const achR = useRef(null);
  const inited = useRef(false);

  useEffect(() => {
    if (inited.current || !data) return;
    inited.current = true;
    setText(nameR, data.name);
    setText(titleR, data.title);
    setText(summaryR, data.summary);
    setText(emailR, data.contact?.email);
    setText(phoneR, data.contact?.phone);
    setText(linkedinR, data.contact?.linkedin);
    setHtml(expR, data.experienceHtml);
    setHtml(skillsR, data.skillsHtml);
    setHtml(coursesR, data.coursesHtml);
    setHtml(achR, data.achievementsHtml);
  }, [data]);

  useImperativeHandle(ref, () => ({
    getRoot: () => rootRef.current,
    harvest: () => ({
      name: txt(nameR),
      title: txt(titleR),
      summary: txt(summaryR),
      contact: { email: txt(emailR), phone: txt(phoneR), linkedin: txt(linkedinR) },
      experienceHtml: html(expR),
      skillsHtml: html(skillsR),
      coursesHtml: html(coursesR),
      achievementsHtml: html(achR),
    }),
  }));

  const ed = { contentEditable: true, suppressContentEditableWarning: true, spellCheck: false };

  return (
    <div
      className="resumeTemplate"
      ref={rootRef}
      style={{ "--accent": accent, "--heading": headingColor }}
    >
      <header className="rtHeader">
        <div className="rtHeadMain">
          <div className="rtName" ref={nameR} {...ed} data-ph="Your Name" />
          <div className="rtTitle" ref={titleR} {...ed} data-ph="Your Title" />
          <div className="rtSummary" ref={summaryR} {...ed} data-ph="Short professional summary…" />
        </div>
        <div className="rtPhotoWrap">
          {photo ? (
            <img className="rtPhoto" src={photo} alt="" />
          ) : (
            <div className="rtPhoto rtPhotoEmpty">Photo</div>
          )}
        </div>
      </header>

      <div className="rtContact">
        <span className="rtContactItem">✉&nbsp;<span ref={emailR} {...ed} data-ph="email@example.com" /></span>
        <span className="rtContactItem">☎&nbsp;<span ref={phoneR} {...ed} data-ph="+00 000 000 0000" /></span>
        <span className="rtContactItem">in&nbsp;<span ref={linkedinR} {...ed} data-ph="linkedin.com/in/you" /></span>
      </div>

      <div className="rtBody">
        <div className="rtCol rtLeft">
          <section className="rtSection">
            <h3>Work Experience</h3>
            <div className="rtRegion" ref={expR} {...ed} data-ph="Your roles, projects and bullet points…" />
          </section>
        </div>
        <div className="rtCol rtRight">
          <section className="rtSection">
            <h3>Skills</h3>
            <div className="rtRegion" ref={skillsR} {...ed} data-ph="Your skills…" />
          </section>
          <section className="rtSection">
            <h3>Courses &amp; Certification</h3>
            <div className="rtRegion" ref={coursesR} {...ed} data-ph="Courses & certifications…" />
          </section>
          <section className="rtSection">
            <h3>Achievements</h3>
            <div className="rtRegion" ref={achR} {...ed} data-ph="Achievements…" />
          </section>
        </div>
      </div>
    </div>
  );
});

function setText(r, v) {
  if (r.current) r.current.textContent = v || "";
}
function setHtml(r, v) {
  if (r.current) r.current.innerHTML = v || "";
}
function txt(r) {
  return (r.current?.textContent || "").trim();
}
function html(r) {
  return (r.current?.innerHTML || "").trim();
}

export default ResumeTemplate;
