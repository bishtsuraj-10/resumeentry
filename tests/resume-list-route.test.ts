import { beforeEach, describe, expect, it, vi } from "vitest";
const mock=vi.hoisted(()=>({auth:vi.fn(),list:vi.fn(),count:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireApiSession:mock.auth}));
vi.mock("@/lib/db",()=>({db:{resume:{findMany:mock.list,count:mock.count}}}));
import { GET } from "../app/api/resumes/route";
import { resumeOverviewSelect } from "../lib/resume-overview";
beforeEach(()=>{vi.resetAllMocks();mock.auth.mockResolvedValue(null);mock.count.mockResolvedValue(26);mock.list.mockResolvedValue([{id:"synthetic",fileName:"synthetic.pdf",fileType:"pdf",fileSize:BigInt(1),status:"REVIEW",createdAt:new Date("2026-10-13"),extraction:{name:"Synthetic Person",email:"synthetic@example.com",phone:null,designation:"Engineer",overallConfidence:.94,reviewedAt:null},candidate:{firstName:"Synthetic",lastName:"Person",headline:"Engineer",locationText:"Synthetic City",totalExperienceMonths:36,skills:[{skill:{canonicalName:"Python"}}],education:[{degree:"Master of Science",fieldOfStudy:"Analytics",institution:"Synthetic University",endYear:2020}]}}]);});
describe("recruiter overview query",()=>{
  it("selects bounded relations once and excludes full histories and private provenance",async()=>{
    const response=await GET(new Request("http://localhost/api/resumes?page=2&limit=25&status=REVIEW&search=synthetic")),body=await response.json();
    expect(mock.list).toHaveBeenCalledTimes(1);expect(mock.count).toHaveBeenCalledTimes(1);
    expect(mock.list.mock.calls[0][0]).toMatchObject({select:resumeOverviewSelect,where:{status:"REVIEW"},skip:25,take:25});
    expect(resumeOverviewSelect.candidate.select).not.toHaveProperty("employment");expect(resumeOverviewSelect.extraction.select).not.toHaveProperty("otherEmails");
    expect(body.items[0].overview).toMatchObject({location:"Synthetic City",totalExperienceMonths:36,skills:["Python"],education:"Master of Science · Analytics"});expect(body.items[0]).not.toHaveProperty("candidate");expect(body.pages).toBe(2);
  });
  it("checks permission before accessing overview data",async()=>{mock.auth.mockResolvedValue(Response.json({error:"Forbidden"},{status:403}));expect((await GET(new Request("http://localhost/api/resumes"))).status).toBe(403);expect(mock.list).not.toHaveBeenCalled();});
});
