import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { isolatedDatabase } from "./helpers/isolated-db";

const url = process.env.M3_TEST_DATABASE_URL;
const migrationPath = "prisma/migrations/20261014010000_candidate_field_cleanup/migration.sql";
const { Client } = createRequire(import.meta.url)("pg");
describe.skipIf(!url)("M3.5 forward migration preservation and abort guards", () => {
  async function legacy() {
    const database = await isolatedDatabase(url!, { beforeCleanupMigration: true });
    const client = new Client({ connectionString: url, options: `-c search_path=${database.schema}` });
    await client.connect();
    await client.query(`INSERT INTO "Resume" (id,"fileName","filePath","fileType","fileSize","fileHash",status,"updatedAt") VALUES ('cleanup','synthetic.pdf','cleanup','pdf',1,'cleanup','REVIEW',CURRENT_TIMESTAMP)`);
    await client.query(`INSERT INTO "ResumeExtraction" (id,"resumeId",name,email,phone,"normalizedPhone","countryCode","updatedAt") VALUES ('cleanup-extraction','cleanup','Synthetic Candidate','primary@example.test','+919876543210','+919876543210','+91',CURRENT_TIMESTAMP)`);
    await client.query(`INSERT INTO "CandidateProfile" ("resumeId","firstName","lastName",revision,"updatedAt") VALUES ('cleanup','Synthetic','Candidate',7,CURRENT_TIMESTAMP)`);
    await client.query(`INSERT INTO "ExtractionRun" (id,"resumeId",method,"startedAt") VALUES ('cleanup-run','cleanup','HUMAN',CURRENT_TIMESTAMP)`);
    await client.query(`INSERT INTO "CandidateEvidence" (id,"runId","fieldPath",text) VALUES ('old-proof','cleanup-run','profile.firstName','Synthetic')`);
    return { client, database, cleanup: async () => { await client.end(); await database.cleanup(); } };
  }
  it("consolidates explicit components and drops exactly eight columns without altering identity, statuses or evidence", async () => {
    const { client, cleanup } = await legacy();
    try {
      await client.query(`UPDATE "CandidateProfile" SET city='Dehradun',region='Uttarakhand',country='India' WHERE "resumeId"='cleanup'`);
      const before = (await client.query('SELECT * FROM "Resume" ORDER BY id')).rows;
      await client.query(await readFile(migrationPath, "utf8"));
      expect((await client.query('SELECT * FROM "Resume" ORDER BY id')).rows).toEqual(before);
      expect((await client.query(`SELECT "locationText",revision FROM "CandidateProfile" WHERE "resumeId"='cleanup'`)).rows[0]).toEqual({ locationText: "Dehradun, Uttarakhand, India", revision: 7 });
      expect((await client.query(`SELECT name,email,phone,"normalizedPhone","countryCode" FROM "ResumeExtraction" WHERE "resumeId"='cleanup'`)).rows[0]).toMatchObject({ name: "Synthetic Candidate", email: "primary@example.test", phone: "+919876543210", normalizedPhone: "+919876543210", countryCode: "+91" });
      expect((await client.query(`SELECT text FROM "CandidateEvidence" WHERE id='old-proof'`)).rows[0].text).toBe("Synthetic");
      const columns = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name IN ('CandidateProfile','ResumeExtraction')`)).rows.map((r: { column_name: string }) => r.column_name);
      for (const field of ["firstName","lastName","additionalEmails","additionalPhones","city","region","country","otherEmails"]) expect(columns).not.toContain(field);
      expect((await client.query(`SELECT count(*)::int AS count FROM pg_indexes WHERE schemaname=current_schema() AND indexname='CandidateProfile_city_country_idx'`)).rows[0].count).toBe(0);
    } finally { await cleanup(); }
  }, 30000);
  it.each([null, "", "  ", "Paris, France"])("preserves a verified location value %s when no component backfill is needed", async location => {
    const { client, cleanup } = await legacy();
    try {
      await client.query(`UPDATE "CandidateProfile" SET "locationText"=$1,"verifiedAt"=CURRENT_TIMESTAMP WHERE "resumeId"='cleanup'`, [location]);
      await client.query(`INSERT INTO "CandidateEvidence" (id,"runId","fieldPath","verifiedAt") VALUES ('manual-location','cleanup-run','profile.locationText',CURRENT_TIMESTAMP)`);
      await client.query(await readFile(migrationPath, "utf8"));
      expect((await client.query(`SELECT "locationText" FROM "CandidateProfile" WHERE "resumeId"='cleanup'`)).rows[0].locationText).toBe(location);
    } finally { await cleanup(); }
  }, 30000);
  it.each([
    ["conflicting split name", `UPDATE "CandidateProfile" SET "firstName"='Different' WHERE "resumeId"='cleanup'`],
    ["legacy secondary email", `UPDATE "ResumeExtraction" SET "otherEmails"=ARRAY['secondary@example.test'] WHERE "resumeId"='cleanup'`],
    ["profile secondary email", `UPDATE "CandidateProfile" SET "additionalEmails"=ARRAY['secondary@example.test'] WHERE "resumeId"='cleanup'`],
    ["secondary phone", `UPDATE "CandidateProfile" SET "additionalPhones"='["+14155550100"]'::jsonb WHERE "resumeId"='cleanup'`],
    ["conflicting complete location", `UPDATE "CandidateProfile" SET city='Dehradun',"locationText"='Paris' WHERE "resumeId"='cleanup'`],
    ["manual location clear", `UPDATE "CandidateProfile" SET city='Dehradun',"verifiedAt"=CURRENT_TIMESTAMP WHERE "resumeId"='cleanup'`],
    ["field evidence for a manual clear", `UPDATE "CandidateProfile" SET city='Dehradun' WHERE "resumeId"='cleanup'; INSERT INTO "CandidateEvidence" (id,"runId","fieldPath","verifiedAt") VALUES ('manual-location','cleanup-run','profile.locationText',CURRENT_TIMESTAMP)`],
    ["placeholder component", `UPDATE "CandidateProfile" SET city='Unknown' WHERE "resumeId"='cleanup'`],
    ["oversized consolidation", `UPDATE "CandidateProfile" SET city=repeat('a',200),region=repeat('b',200),country=repeat('c',200) WHERE "resumeId"='cleanup'`],
  ])("aborts atomically for %s", async (_reason, setup) => {
    const { client, cleanup } = await legacy();
    try {
      await client.query(setup);
      const before = (await client.query('SELECT * FROM "CandidateProfile" ORDER BY "resumeId"')).rows;
      await expect(client.query(await readFile(migrationPath, "utf8"))).rejects.toThrow("M3.5 stopped:");
      await client.query("ROLLBACK");
      expect((await client.query('SELECT * FROM "CandidateProfile" ORDER BY "resumeId"')).rows).toEqual(before);
      expect((await client.query(`SELECT status FROM "Resume" WHERE id='cleanup'`)).rows[0].status).toBe("REVIEW");
      expect((await client.query(`SELECT count(*)::int AS count FROM "CandidateEvidence" WHERE id='old-proof'`)).rows[0].count).toBe(1);
    } finally { await cleanup(); }
  }, 30000);
});
