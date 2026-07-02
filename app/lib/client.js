// Small browser-side helpers shared by pages.

export async function fetchMe() {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json.user || null;
  } catch {
    return null;
  }
}

export async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {}
}

// Read a File as a base64 string (no data: prefix) for upload.
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
