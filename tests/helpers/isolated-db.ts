import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export async function isolatedDatabase(url: string, options: { beforeCleanupMigration?: boolean } = {}) {
  const schema = "m2_test_" + randomUUID().replaceAll("-", "");
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: `-c search_path=${schema}` }, { schema }) });
  const cleanup = async () => {
    await db.$disconnect();
    if (!/^m2_test_[a-f0-9]{32}$/.test(schema)) throw new Error("Unexpected test schema");
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  };
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const { Client } = createRequire(import.meta.url)("pg");
  const client = new Client({ connectionString: url, options: `-c search_path=${schema}` });
  try {
    await client.connect();
    for (const dir of (await readdir("prisma/migrations")).sort()) {
      if (dir === "migration_lock.toml") continue;
      if (options.beforeCleanupMigration && dir === "20261014010000_candidate_field_cleanup") continue;
      if (dir === "20261013020000_candidate_data") {
        await client.query(`INSERT INTO "Resume" ("id","fileName","filePath","fileType","fileSize","fileHash","status","updatedAt") VALUES ('legacy-m2','legacy.pdf','legacy-m2','pdf',1,'legacy-m2','COMPLETED',CURRENT_TIMESTAMP)`);
        await client.query(`INSERT INTO "ResumeExtraction" ("id","resumeId","name","email","nameConfidence","reviewedAt","updatedAt") VALUES ('legacy-extraction','legacy-m2','Legacy Candidate','legacy@example.com',0.8,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
      }
      const sql = await readFile(`prisma/migrations/${dir}/migration.sql`, "utf8");
      await client.query(sql.replace('CREATE SCHEMA IF NOT EXISTS "public";', ""));
    }
    return { db, cleanup, schema };
  } catch (error) { await cleanup(); throw error; }
  finally { await client.end(); }
}
