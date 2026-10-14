import { z } from "zod";
import { requireApiSession, session } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveReview } from "@/lib/processing";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { candidateInclude } from "@/lib/candidate-data";
import { publicResume } from "@/lib/candidate-http";

const updateSchema = z.object({
  name: z.string().trim().max(200).nullable(),
  email: z.string().email().nullable(),
  phone: z.string().trim().max(40).nullable(),
  designation: z.string().trim().max(200).nullable(),
});
export async function GET(
  _request: Request,
  context: RouteContext<"/api/resumes/[id]">,
) {
  const unauthorized = await requireApiSession("resumes.view");
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const resume = await db.resume.findUnique({
    where: { id },
    include: {
      extraction: true,
      candidate: { include: candidateInclude },
      extractionRuns: {
        where: { method: "HUMAN" },
        orderBy: { startedAt: "desc" },
        take: 100,
        select: {
          evidence: {
            where: { verifiedAt: { not: null } },
            select: { fieldPath: true },
            take: 200,
          },
        },
      },
      errors: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!resume)
    return Response.json({ error: "Resume not found." }, { status: 404 });
  const { extractionRuns, ...record } = resume;
  return Response.json(
    {
      ...publicResume(record),
      manualFields: [
        ...new Set(
          (extractionRuns ?? []).flatMap((run) =>
            run.evidence.map((e) => e.fieldPath),
          ),
        ),
      ],
    },
    {
      headers: { "cache-control": "no-store" },
    },
  );
}
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/resumes/[id]">,
) {
  const unauthorized = await requireApiSession("resumes.edit", request);
  if (unauthorized) return unauthorized;
  const actor = (await session())?.id;
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Invalid review data." }, { status: 400 });
  const resume = await db.resume.findUnique({
    where: { id },
    include: { extraction: true },
  });
  if (!resume)
    return Response.json({ error: "Resume not found." }, { status: 404 });
  const data = parsed.data;
  const parsedPhone = data.phone
    ? parsePhoneNumberFromString(data.phone, "IN")
    : undefined;
  const extraction = await saveReview(db, id, actor, {
    name: data.name,
    email: data.email?.toLowerCase() ?? null,
    phone: parsedPhone?.formatInternational() ?? data.phone,
    normalizedPhone: parsedPhone?.isValid() ? parsedPhone.number : null,
    countryCode: parsedPhone?.countryCallingCode
      ? `+${parsedPhone.countryCallingCode}`
      : null,
    designation: data.designation,
  });
  if (!extraction)
    return Response.json(
      { error: "Cancelled resumes cannot be reviewed." },
      { status: 409 },
    );
  return Response.json(extraction);
}
