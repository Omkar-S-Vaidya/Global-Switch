// Session auth: bcrypt for passwords, a signed JWT stored in an httpOnly cookie
// for the session. `jose` is pure-JS and works in the Node runtime.
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set — add it to .env");
  return new TextEncoder().encode(s);
}

export function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}
export function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(user) {
  const token = await new SignJWT({ uid: user.id, email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

// Returns { uid, email, name } or null. Use in route handlers to gate access.
export async function getSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload;
  } catch {
    return null;
  }
}
