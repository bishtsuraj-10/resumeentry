import { expect, it, vi } from "vitest";
vi.mock("../app/(workspace)/page-access",()=>({default:()=>null}));
vi.mock("../app/(workspace)/resumes/[id]/client",()=>({default:()=>null}));
import Page from "../app/(workspace)/resumes/[id]/page";
it("awaits a thenable whose then returns undefined and passes only a resolved ID",async()=>{
  const params={then(resolve:(v:{id:string})=>void){resolve({id:"synthetic-id"});}} as unknown as Promise<{id:string}>;
  const result=Page({params,searchParams:Promise.resolve({})});
  const child=await result.props.render();
  expect(child.props).toEqual({id:"synthetic-id"});
  expect(result.props.permission).toBe("resumes.view");
});
it("defers params access to the authorized render inside PageAccess Suspense", async () => {
  const then = vi.fn((resolve: (value: { id: string }) => void) => {
    resolve({ id: "deferred-id" });
  });
  const params = { then } as unknown as Promise<{ id: string }>;
  const result = Page({ params, searchParams: Promise.resolve({}) });
  expect(then).not.toHaveBeenCalled();
  expect(result.props.permission).toBe("resumes.view");
  const child = await result.props.render();
  expect(then).toHaveBeenCalledOnce();
  expect(child.props).toEqual({ id: "deferred-id" });
});
