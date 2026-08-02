"use client";

import { useRouter, usePathname } from "next/navigation";
import { logout } from "../lib/client";
import ThemeToggle from "./ThemeToggle";

// Two navigations, one source of truth. The top bar carries branding and account
// actions at every width; the section links move to a fixed bottom tab bar on
// mobile, where thumb reach matters more than horizontal space.
const LINKS = [
  { href: "/", label: "Jobs", icon: "💼" },
  { href: "/companies", label: "Companies", icon: "🗂️" },
  { href: "/pipeline", label: "Pipeline", icon: "📈" },
  { href: "/profile", label: "Profile", icon: "👤" },
];

export default function Nav({ user }) {
  const router = useRouter();
  const pathname = usePathname();

  const onLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <>
      <nav className="nav">
        <div className="navinner">
          <button className="brand" onClick={() => router.push("/")}>
            <span className="brandmark" aria-hidden>
              ◆
            </span>
            <span className="brandname">JobHunt</span>
          </button>

          <div className="navlinks">
            {LINKS.map((l) => (
              <button
                key={l.href}
                className={`navlink ${pathname === l.href ? "active" : ""}`}
                onClick={() => router.push(l.href)}
              >
                <span aria-hidden>{l.icon}</span>
                <span className="navlabel">{l.label}</span>
              </button>
            ))}
          </div>

          <div className="navuser">
            <ThemeToggle />
            <span className="avatar" title={user?.email || ""}>
              {initial}
            </span>
            <button className="logout" onClick={onLogout}>
              Logout
            </button>
          </div>
        </div>
      </nav>

      <nav className="tabbar" aria-label="Sections">
        {LINKS.map((l) => (
          <button
            key={l.href}
            className={`tabitem ${pathname === l.href ? "active" : ""}`}
            onClick={() => router.push(l.href)}
            aria-current={pathname === l.href ? "page" : undefined}
          >
            <span className="tabicon" aria-hidden>
              {l.icon}
            </span>
            <span>{l.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
