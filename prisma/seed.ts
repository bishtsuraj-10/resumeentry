import "dotenv/config";
import { db } from "../lib/db";

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPasswordHash = process.env.SEED_ADMIN_PASSWORD_HASH;

  if (!adminEmail || !adminPasswordHash) {
    throw new Error(
      "Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD_HASH before seeding.",
    );
  }

  const admin = await db.user.upsert({
    where: {
      email: adminEmail,
    },
    create: {
      name: "Workspace Administrator",
      email: adminEmail,
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      isActive: true,
    },
    update: {},
  });

  console.info(`Administrator account initialized: ${admin.email}`);
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
