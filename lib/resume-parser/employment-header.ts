import { jobTitle } from "./basic";
import { dateRange } from "./validators/dates";

// Employer on one row, owned role and dates on the immediately following row.
// The layout supplies ownership; no company/candidate dictionary is involved.
export function stackedEmploymentHeader(company: string, roleAndDates: string) {
  const dates = dateRange(roleAndDates);
  if (!dates || dateRange(company) || /^[-•*]|^(?:project|client|team|role|location)\s*:|^(?:responsible for|worked on|managed|led|delivered)\b/i.test(company)) return null;
  const role = roleAndDates.slice(0, roleAndDates.indexOf(dates.matched)).replace(/[|\t\s-]+$/, "").trim();
  const roles = role.split(/\s+\/\s+/);
  if (/[|\t]/.test(role) || role.length > 120 || roles.some(part => {
    const title = jobTitle(part);
    return !title || !part.toLowerCase().startsWith(title.toLowerCase());
  })) return null;
  const parts = company.split(/\s+-\s+/);
  const employer = parts[0].trim();
  if (!employer || employer.length > 200 || employer.split(/\s+/).length > 12 || /[|\t:]|^[\d•*-]/.test(employer)) return null;
  // A prior role heading is not an employer simply because it precedes a date.
  if (jobTitle(employer)?.toLowerCase() === employer.toLowerCase()) return null;
  if (parts.length > 2 || (parts.length === 1 &&
    !/\b(?:ltd|limited|inc|llc|corporation|companies|company|labs|clinic|studio)\b/i.test(employer))) return null;
  return { employer, designation: role, location: parts[1]?.trim() || null };
}
