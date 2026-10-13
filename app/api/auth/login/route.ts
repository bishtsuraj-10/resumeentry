import bcrypt from "bcryptjs";
import { z } from "zod";
import { checkOrigin, createSession } from "@/lib/auth";
import { db } from "@/lib/db";

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  const forbidden = checkOrigin(request);
  if (forbidden) return forbidden;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json(
      { error: "Enter a valid email and password." },
      { status: 400 },
    );
  try {
    const email = input.data.email.toLowerCase();
    const user = await db.user.findUnique({
      where: { email },
      include: { assignedRole: true },
    });
    const valid = await bcrypt.compare(
      input.data.password,
      user?.passwordHash ??
        "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxM4RjV8q8p7K0zUarFTJQGzW6a",
    );
    if (!user || !user.isActive || !user.assignedRole || !valid)
      return Response.json({ error: "Invalid credentials." }, { status: 401 });
    await createSession(user);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Admin login failed:", error);
    return Response.json(
      {
        error:
          "Login is temporarily unavailable. Restart the app and try again.",
      },
      { status: 500 },
    );
  }
}
