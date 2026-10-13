import "server-only";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { checkOrigin, session, type Account } from "./auth";
import {
  PERMISSIONS,
  effectivePermissions,
  hasPermission,
  type Permission,
} from "./permissions";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(12)
  .max(72)
  .refine(
    (value) => !bcrypt.truncates(value),
    "Password exceeds 72 UTF-8 bytes.",
  );
const name = z.string().trim().min(1).max(120);
export const createUserSchema = z
  .object({
    name,
    email: emailSchema,
    password: passwordSchema,
    role: z.string().min(1).max(100),
    isActive: z.boolean().default(true),
  })
  .strict();
export const editUserSchema = z
  .object({ name: name.optional(), email: emailSchema.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const permissionsSchema = z
  .object({ permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length) })
  .strict();
const roleSchema = z
  .object({ key: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), name })
  .strict();
const pagination = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(150).default(""),
  })
  .strict();
export const safeUser = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assertNotSelf(actorId: string, targetId: string) {
  if (actorId === targetId)
    throw new ApiError(
      403,
      "You cannot change your own role, grants, or active status.",
    );
}
export function assertAdminRemains(
  target: { role: string; isActive: boolean },
  next: { role?: string; isActive?: boolean },
  count: number,
) {
  if (
    target.role === "ADMIN" &&
    target.isActive &&
    ((next.role && next.role !== "ADMIN") || next.isActive === false) &&
    count <= 1
  )
    throw new ApiError(409, "The final active Administrator must be retained.");
}
export function assertCustomRole(role: { key: string; isSystem: boolean }) {
  if (role.key === "ADMIN" || role.isSystem)
    throw new ApiError(403, "System roles are protected.");
}
async function body(request: Request) {
  return request.json().catch(() => null);
}
async function requireRole(tx: Prisma.TransactionClient, key: string) {
  const role = await tx.role.findUnique({ where: { key } });
  if (!role) throw new ApiError(400, "Role does not exist.");
  return role;
}
async function requireUser(tx: Prisma.TransactionClient, id: string) {
  const user = await tx.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "User not found.");
  return user;
}

// All administrative mutations take the same transaction-scoped lock BEFORE reading
// authority, role usage or the active Admin count. This serializes competing demotions.
async function mutation(
  actor: Account,
  permission: Permission,
  action: string,
  targetId: string | undefined,
  change: (
    tx: Prisma.TransactionClient,
  ) => Promise<{ result: unknown; metadata?: Prisma.InputJsonObject }>,
) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(20261010, 1)::text`;
      const current = await tx.user.findUnique({
        where: { id: actor.id },
        include: {
          assignedRole: { include: { permissions: true } },
          grants: true,
        },
      });
      if (
        !current ||
        !current.isActive ||
        current.sessionVersion !== actor.sessionVersion
      )
        throw new ApiError(401, "Unauthorized");
      const permissions = effectivePermissions(
        current.assignedRole.permissions.map((p) => p.permission),
        current.grants.map((p) => p.permission),
      );
      if (!hasPermission({ role: current.role, permissions }, permission))
        throw new ApiError(403, "Forbidden");
      const { result, metadata } = await change(tx);
      await tx.auditLog.create({
        data: { actor: actor.id, action, targetId, metadata },
      });
      return result;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10000,
      timeout: 20000,
    },
  );
}

type Operation =
  | "users"
  | "user"
  | "status"
  | "password"
  | "assignment"
  | "grants"
  | "roles"
  | "role"
  | "rolePermissions"
  | "catalog";
export async function managementApi(
  request: Request,
  operation: Operation,
  permission: Permission,
  id?: string,
) {
  try {
    const forbidden = checkOrigin(request);
    if (request.method !== "GET" && forbidden) return forbidden;
    const actor = await session();
    if (!actor)
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasPermission(actor, permission))
      return Response.json({ error: "Forbidden" }, { status: 403 });
    const method = request.method;
    if (method === "GET") {
      let result: unknown;
      if (operation === "catalog") result = { permissions: PERMISSIONS };
      else if (operation === "users") {
        const { page, limit, search } = pagination.parse(
          Object.fromEntries(new URL(request.url).searchParams),
        );
        const where = search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {};
        const [items, total] = await db.$transaction([
          db.user.findMany({
            where,
            select: safeUser,
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            skip: (page - 1) * limit,
            take: limit,
          }),
          db.user.count({ where }),
        ]);
        result = { items, total, page, pages: Math.ceil(total / limit) };
      } else if (operation === "user") {
        result = await db.user.findUnique({
          where: { id: id! },
          select: safeUser,
        });
        if (!result) throw new ApiError(404, "User not found.");
      } else if (operation === "roles")
        result = {
          items: await db.role.findMany({
            include: { permissions: true, _count: { select: { users: true } } },
            orderBy: { name: "asc" },
          }),
        };
      else if (operation === "grants") {
        const user = await db.user.findUnique({
          where: { id: id! },
          include: {
            assignedRole: { include: { permissions: true } },
            grants: true,
          },
        });
        if (!user) throw new ApiError(404, "User not found.");
        const inherited = effectivePermissions(
          user.assignedRole.permissions.map((p) => p.permission),
          [],
        );
        const additional = effectivePermissions(
          [],
          user.grants.map((p) => p.permission),
        );
        result = {
          userId: user.id,
          role: user.role,
          inherited,
          additional,
          effective: effectivePermissions(inherited, additional),
        };
      } else throw new ApiError(405, "Unsupported operation.");
      return Response.json(result, {
        headers: { "cache-control": "no-store" },
      });
    }
    const input =
      method === "DELETE" && operation === "role" ? null : await body(request);
    let prepared: unknown = input;
    if (operation === "users") {
      const data = createUserSchema.parse(input);
      prepared = {
        ...data,
        passwordHash: await bcrypt.hash(data.password, 12),
      };
    }
    if (operation === "password") {
      const data = z.object({ password: passwordSchema }).strict().parse(input);
      prepared = { passwordHash: await bcrypt.hash(data.password, 12) };
    }
    const result = await mutation(
      actor,
      permission,
      operation + "." + method.toLowerCase(),
      id,
      async (tx) => {
        if (operation === "users") {
          const parsed = prepared as z.infer<typeof createUserSchema> & {
            passwordHash: string;
          };
          const data = {
            name: parsed.name,
            email: parsed.email,
            role: parsed.role,
            isActive: parsed.isActive,
            passwordHash: parsed.passwordHash,
          };
          await requireRole(tx, data.role);
          // Case-insensitive check also protects legacy emails that were not normalized.
          if (
            await tx.user.findFirst({
              where: { email: { equals: data.email, mode: "insensitive" } },
            })
          )
            throw new ApiError(409, "Email is already in use.");
          const user = await tx.user.create({ data, select: safeUser });
          return {
            result: user,
            metadata: {
              userId: user.id,
              role: user.role,
              isActive: user.isActive,
            },
          };
        }
        if (operation === "roles") {
          const data = roleSchema.parse(input);
          if (data.key === "ADMIN")
            throw new ApiError(403, "System roles are protected.");
          const role = await tx.role.create({ data });
          return { result: role, metadata: { roleKey: role.key } };
        }
        if (operation === "role" || operation === "rolePermissions") {
          const role = await requireRole(tx, id!);
          assertCustomRole(role);
          if (method === "DELETE") {
            if (await tx.user.count({ where: { role: id! } }))
              throw new ApiError(409, "Assigned roles cannot be deleted.");
            await tx.role.delete({ where: { key: id! } });
            return { result: { ok: true } };
          }
          if (operation === "role") {
            const data = z.object({ name }).strict().parse(input);
            return {
              result: await tx.role.update({ where: { key: id! }, data }),
              metadata: { before: role.name, after: data.name },
            };
          }
          const { permissions } = permissionsSchema.parse(input);
          const before = await tx.rolePermission.findMany({
            where: { roleKey: id! },
            select: { permission: true },
          });
          await tx.rolePermission.deleteMany({ where: { roleKey: id! } });
          await tx.rolePermission.createMany({
            data: [...new Set(permissions)].map((permission) => ({
              roleKey: id!,
              permission,
            })),
          });
          return {
            result: { permissions: [...new Set(permissions)] },
            metadata: {
              before: before.map((p) => p.permission),
              after: permissions,
            },
          };
        }
        const user = await requireUser(tx, id!);
        if (operation === "user") {
          const data = editUserSchema.parse(input);
          if (
            data.email &&
            (await tx.user.findFirst({
              where: {
                id: { not: id! },
                email: { equals: data.email, mode: "insensitive" },
              },
            }))
          )
            throw new ApiError(409, "Email is already in use.");
          return {
            result: await tx.user.update({
              where: { id: id! },
              data,
              select: safeUser,
            }),
            metadata: { fields: Object.keys(data) },
          };
        }
        if (operation === "password") {
          return {
            result: await tx.user.update({
              where: { id: id! },
              data: {
                ...(prepared as { passwordHash: string }),
                sessionVersion: { increment: 1 },
              },
              select: safeUser,
            }),
          };
        }
        assertNotSelf(actor.id, id!);
        if (operation === "status" || operation === "assignment") {
          const data =
            operation === "status"
              ? z.object({ isActive: z.boolean() }).strict().parse(input)
              : z
                  .object({ role: z.string().min(1).max(100) })
                  .strict()
                  .parse(input);
          if ("role" in data) await requireRole(tx, data.role);
          assertAdminRemains(
            user,
            data,
            await tx.user.count({ where: { role: "ADMIN", isActive: true } }),
          );
          const updated = await tx.user.update({
            where: { id: id! },
            data: {
              ...data,
              ...("isActive" in data && !data.isActive
                ? { sessionVersion: { increment: 1 } }
                : {}),
            },
            select: safeUser,
          });
          return {
            result: updated,
            metadata: {
              before: { role: user.role, isActive: user.isActive },
              after: { role: updated.role, isActive: updated.isActive },
            },
          };
        }
        if (operation === "grants") {
          const { permissions } = permissionsSchema.parse(input);
          if (method === "DELETE")
            await tx.userPermissionGrant.deleteMany({
              where: { userId: id!, permission: { in: permissions } },
            });
          else
            await tx.userPermissionGrant.createMany({
              data: [...new Set(permissions)].map((permission) => ({
                userId: id!,
                permission,
              })),
              skipDuplicates: true,
            });
          return { result: { ok: true }, metadata: { permissions } };
        }
        throw new ApiError(405, "Unsupported operation.");
      },
    );
    return Response.json(result, {
      status:
        method === "POST" && ["users", "roles"].includes(operation) ? 201 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json({ error: "Invalid input." }, { status: 400 });
    if (error instanceof ApiError)
      return Response.json({ error: error.message }, { status: error.status });
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return Response.json(
        { error: "Email or role already exists." },
        { status: 409 },
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    )
      return Response.json(
        { error: "Record is still in use." },
        { status: 409 },
      );
    return Response.json(
      { error: "Administration is temporarily unavailable." },
      { status: 500 },
    );
  }
}
