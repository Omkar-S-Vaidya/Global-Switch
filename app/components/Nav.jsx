"use client";

import { useRouter, usePathname } from "next/navigation";
import { logout } from "../lib/client";

export default function Nav({ user }) {
  const router = useRouter();
  const pathname = usePathname();

  const onLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const link = (href, label, icon) => (
    <button
      className={`navlink ${pathname === href ? "active" : ""}`}
      onClick={() => router.push(href)}
    >
      <span aria-hidden>{icon}</span>
      <span className="navlabel">{label}</span>
    </button>
  );

  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <nav className="nav">
      <div className="navinner">
        <button className="brand" onClick={() => router.push("/")}>
          <span className="brandmark">🎯</span>
          <span className="brandname">JobHunt</span>
        </button>

        <div className="navlinks">
          {link("/", "Jobs", "💼")}
          {link("/companies", "Companies", "🗂️")}
          {link("/pipeline", "Pipeline", "📈")}
          {link("/profile", "Profile", "👤")}
        </div>

        <div className="navuser">
          <span className="avatar" title={user?.email || ""}>{initial}</span>
          <button className="logout" onClick={onLogout}>Logout</button>
        </div>
      </div>
    </nav>
  );
}
