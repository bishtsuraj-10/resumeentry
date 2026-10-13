import { z } from "zod";
import { requireApiSession, session } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

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
      errors: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  return resume
    ? Response.json({
        ...Object.fromEntries(
          Object.entries(resume).filter(([key]) => key !== "filePath"),
        ),
        fileSize: Number(resume.fileSize),
      })
    : Response.json({ error: "Resume not found." }, { status: 404 });
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
  const confidence = {
    nameConfidence: data.name ? 1 : 0,
    emailConfidence: data.email ? 1 : 0,
    phoneConfidence: data.phone ? 1 : 0,
    designationConfidence: data.designation ? 1 : 0,
  };
  const overallConfidence =
    (confidence.nameConfidence +
      confidence.emailConfidence +
      confidence.phoneConfidence +
      confidence.designationConfidence) /
    4;
  const parsedPhone = data.phone
    ? parsePhoneNumberFromString(data.phone, "IN")
    : undefined;
  const extraction = await db.resumeExtraction.upsert({
    where: { resumeId: id },
    create: {
      resumeId: id,
      name: data.name,
      email: data.email?.toLowerCase() ?? null,
      phone: parsedPhone?.formatInternational() ?? data.phone,
      normalizedPhone: parsedPhone?.isValid() ? parsedPhone.number : null,
      countryCode: parsedPhone?.countryCallingCode
        ? `+${parsedPhone.countryCallingCode}`
        : null,
      designation: data.designation,
      ...confidence,
      overallConfidence,
      requiresReview: false,
      reviewedAt: new Date(),
    },
    update: {
      name: data.name,
      email: data.email?.toLowerCase() ?? null,
      phone: parsedPhone?.formatInternational() ?? data.phone,
      normalizedPhone: parsedPhone?.isValid() ? parsedPhone.number : null,
      countryCode: parsedPhone?.countryCallingCode
        ? `+${parsedPhone.countryCallingCode}`
        : null,
      designation: data.designation,
      ...confidence,
      overallConfidence,
      requiresReview: false,
      reviewedAt: new Date(),
    },
  });
  await db.resume.update({ where: { id }, data: { status: "COMPLETED" } });
  await db.auditLog.create({
    data: { actor, action: "resume.reviewed", targetId: id },
  });
  return Response.json(extraction);
}
