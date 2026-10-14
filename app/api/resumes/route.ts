import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { publicResume } from "@/lib/candidate-http";
import { resumeOverview, resumeOverviewSelect } from "@/lib/resume-overview";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(150).optional(),
  status: z
    .enum([
      "PENDING",
      "PROCESSING",
      "COMPLETED",
      "FAILED",
      "REVIEW",
      "DUPLICATE",
      "CANCELLED",
    ])
    .optional(),
});
export async function GET(request: Request) {
  const unauthorized = await requireApiSession("resumes.view");
  if (unauthorized) return unauthorized;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success)
    return Response.json({ error: "Invalid resume query." }, { status: 400 });
  const { page, limit, search, status } = parsed.data;
  const where = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { fileName: { contains: search, mode: "insensitive" as const } },
            {
              extraction: {
                is: {
                  OR: [
                    {
                      name: { contains: search, mode: "insensitive" as const },
                    },
                    {
                      email: { contains: search, mode: "insensitive" as const },
                    },
                    {
                      designation: {
                        contains: search,
                        mode: "insensitive" as const,
                      },
                    },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.resume.findMany({
      where,
      select: resumeOverviewSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.resume.count({ where }),
  ]);
  return Response.json(
    {
      items: items.map((item) => {
        const { candidate: _candidate, ...row } = item;
        void _candidate;
        return { ...publicResume(row), overview: resumeOverview(item) };
      }),
      total,
      page,
      pages: Math.ceil(total / limit),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
