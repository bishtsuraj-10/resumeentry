import {
  partialDateSchema,
  type PartialCandidateDate,
} from "../../candidate-validation";
const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
export const dateToken =
  "(?:[A-Za-z]{3,9}\\.?\\s+)?(?:19|20|21)\\d{2}|(?:0?[1-9]|1[0-2])[/](?:19|20|21)\\d{2}";
export function parseDate(value: string): PartialCandidateDate | null {
  const text = value.trim();
  let year: number | undefined,
    month: number | undefined,
    day: number | undefined;
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    year = +m[1];
    month = +m[2];
    day = +m[3];
  } else if ((m = text.match(/^(\d{1,2})\/((?:19|20|21)\d{2})$/))) {
    month = +m[1];
    year = +m[2];
  } else if (
    (m = text.match(
      /^(?:(\d{1,2})\s+)?([a-z]{3,9})\.?\s+((?:19|20|21)\d{2})$/i,
    ))
  ) {
    const index = months.indexOf(m[2].slice(0, 3).toLowerCase());
    if (index < 0) return null;
    year = +m[3];
    month = index + 1;
    day = m[1] ? +m[1] : undefined;
  } else if (/^(?:19|20|21)\d{2}$/.test(text)) year = +text;
  else return null;
  const result = partialDateSchema.safeParse({ year, month, day, text });
  return result.success ? result.data : null;
}
export function dateRange(text: string) {
  const m = text.match(
    new RegExp(
      `(${dateToken})\\s*(?:-|to)\\s*(${dateToken}|present|current|now)`,
      "i",
    ),
  );
  if (!m) return null;
  const startDate = parseDate(m[1]);
  const isCurrent = /^(present|current|now)$/i.test(m[2]);
  const endDate = isCurrent ? null : parseDate(m[2]);
  if (!startDate || (!isCurrent && !endDate)) return null;
  if (
    endDate &&
    (startDate.year! > endDate.year! ||
      (startDate.year === endDate.year &&
        startDate.month &&
        endDate.month &&
        startDate.month > endDate.month))
  )
    return null;
  return { startDate, endDate, isCurrent, matched: m[0] };
}
// Half-open monthly intervals. End month is included, current month is excluded.
// Refuse a total if ANY record lacks month precision or has ambiguous dates.
export function experienceMonths(
  entries: {
    startDate?: PartialCandidateDate | null;
    endDate?: PartialCandidateDate | null;
    isCurrent?: boolean | null;
  }[],
  asOf: Date,
): number | null {
  if (!entries.length) return null;
  const intervals: [number, number][] = [];
  for (const e of entries) {
    if (
      !e.startDate?.year ||
      !e.startDate.month ||
      (!e.isCurrent && (!e.endDate?.year || !e.endDate.month))
    )
      return null;
    const start = e.startDate.year * 12 + e.startDate.month - 1;
    const end = e.isCurrent
      ? asOf.getUTCFullYear() * 12 + asOf.getUTCMonth()
      : e.endDate!.year! * 12 + e.endDate!.month!;
    if (
      start >= end ||
      end > asOf.getUTCFullYear() * 12 + asOf.getUTCMonth() + 1
    )
      return null;
    intervals.push([start, end]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0,
    [start, end] = intervals[0];
  for (const [nextStart, nextEnd] of intervals.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd);
    else {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  return total + end - start;
}
