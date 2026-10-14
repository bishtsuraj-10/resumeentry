import { expect, it, vi } from "vitest";
vi.mock("../app/(workspace)/page-access",()=>({default:()=>null}));
vi.mock("../app/(workspace)/resumes/[id]/client",()=>({default:()=>null}));
import Page from "../app/(workspace)/resumes/[id]/page";
it("awaits a thenable whose then returns undefined and passes only a resolved ID",async()=>{
  const params={then(resolve:(v:{id:string})=>void){resolve({id:"synthetic-id"});}} as unknown as Promise<{id:string}>;
  const result=await Page({params,searchParams:Promise.resolve({})});
  const child=result.props.render();
  expect(child.props).toEqual({id:"synthetic-id"});
  expect(result.props.permission).toBe("resumes.view");
});
