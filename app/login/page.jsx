"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { fetchMe } from "../lib/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState("login"); // login | register
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(true);

  // If already logged in, skip straight to the app.
  useEffect(() => {
    fetchMe().then((u) => {
      if (u) router.replace("/");
      else setChecking(false);
    });
  }, [router]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const url = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Something went wrong");
      toast.success(mode === "login" ? "Welcome back!" : "Account created");
      router.replace("/");
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (checking) return <div className="authshell"><div className="spinner" /></div>;

  return (
    <div className="authshell">
      <div className="authcard">
        <div className="authbrand">
          <span className="brandmark big">🎯</span>
          <h1>JobHunt Command Center</h1>
          <p>Live software roles, ranked to your resume.</p>
        </div>

        <div className="authtabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(null); }}>
            Log in
          </button>
          <button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(null); }}>
            Sign up
          </button>
        </div>

        <form className="authform" onSubmit={submit}>
          {mode === "register" && (
            <label>
              Name
              <input
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              placeholder={mode === "register" ? "At least 6 characters" : "Your password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
            />
          </label>

          {error && <p className="autherr">{error}</p>}

          <button className="authbtn" type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>

        <p className="authswitch">
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
            {mode === "login" ? "Create an account" : "Log in"}
          </button>
        </p>
      </div>
    </div>
  );
}
