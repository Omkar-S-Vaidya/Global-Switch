"use client";

import { useEffect, useState } from "react";

// Cycles system → light → dark. "system" is the default so the app follows the
// OS until you deliberately override it; the choice is stored under the same key
// the inline script in layout.jsx reads before first paint.
const KEY = "jobhunt.theme";
const NEXT = { system: "light", light: "dark", dark: "system" };
const ICON = { system: "🖥️", light: "☀️", dark: "🌙" };
const LABEL = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };

export default function ThemeToggle() {
  // Start as null so the server and the first client render agree — the real
  // value is only known once localStorage is readable.
  const [mode, setMode] = useState(null);

  useEffect(() => {
    let saved = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    setMode(saved === "light" || saved === "dark" ? saved : "system");
  }, []);

  const apply = (next) => {
    setMode(next);
    const root = document.documentElement;
    if (next === "system") {
      delete root.dataset.theme;
      try {
        localStorage.removeItem(KEY);
      } catch {}
    } else {
      root.dataset.theme = next;
      try {
        localStorage.setItem(KEY, next);
      } catch {}
    }
  };

  return (
    <button
      className="themebtn"
      onClick={() => apply(NEXT[mode || "system"])}
      title={LABEL[mode || "system"]}
      aria-label={LABEL[mode || "system"]}
    >
      <span suppressHydrationWarning>{ICON[mode || "system"]}</span>
    </button>
  );
}
