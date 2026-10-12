import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { db } from "./db";
import { effectivePermissions, hasPermission, type Permission } from "./permissions";
const cookieName = "talentflow_session";
function signingKey() {
  const secret = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) throw new Error("AUTH_SECRET must contain at least 32 characters in production.");
  return new TextEncoder().encode(secret ?? "development-only-change-me-before-deploying-32chars");
}
export async function createSession(user: { id: string; sessionVersion: number }) {
  const token = await new SignJWT({ sessionVersion: user.sessionVersion }).setSubject(user.id).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(signingKey());
  (await cookies()).set(cookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 60 * 60 * 12 });
}
export async function session() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  let payload;
  try { payload = (await jwtVerify(token, signingKey(), { algorithms: ["HS256"], requiredClaims: ["sub", "iat", "exp"] })).payload; }
  catch { return null; }
  // Legacy tokens require a fresh login at cutover; never trust their role claims.
  if (!payload.sub || !Number.isInteger(payload.sessionVersion) || Number(payload.sessionVersion) < 0) return null;
  const user = await db.user.findUnique({ where: { id: payload.sub }, select: {
    id: true, name: true, email: true, role: true, isActive: true, sessionVersion: true,
    assignedRole: { select: { permissions: { select: { permission: true } } } },
    grants: { select: { permission: true } },
  } });
  if (!user || !user.isActive || user.sessionVersion !== payload.sessionVersion) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, sessionVersion: user.sessionVersion,
    permissions: effectivePermissions(user.assignedRole.permissions.map(p => p.permission), user.grants.map(p => p.permission)) };
}
export type Account = NonNullable<Awaited<ReturnType<typeof session>>>;
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "https" || forwardedProtocol === "http" ? forwardedProtocol : requestUrl.protocol.slice(0, -1);
  let expectedOrigin = requestUrl.origin;
  if (host) {
    try { expectedOrigin = new URL(`${protocol}://${host}`).origin; } catch {}
  }
  if ((origin && origin !== expectedOrigin) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Forbidden origin." }, { status: 403 });
  return null;
}
export async function requireApiSession(permission: Permission, request?: Request) {
  if (request && !["GET", "HEAD"].includes(request.method)) {
    const forbidden = checkOrigin(request); if (forbidden) return forbidden;
  }
  const current = await session();
  if (!current) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(current, permission)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return null;
}
export async function clearSession() { (await cookies()).delete(cookieName); }
