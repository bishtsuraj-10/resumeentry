// pdf-parse's installed PDF.js dependency exposes positions that its text result omits.
// Use public PDF.js APIs for text, retaining pdf-parse for selective raster rendering.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DocumentLimitError } from "./document-limits";
export async function readPdfLayout(
  data: Buffer,
  maxPages: number,
  signal?: AbortSignal,
) {
  const task = getDocument({ data: new Uint8Array(data), verbosity: 0 });
  const abort = () => {
    void task.destroy().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const doc = await task.promise;
    signal?.throwIfAborted();
    if (doc.numPages > maxPages) throw new DocumentLimitError();
    let totalCharacters = 0;
    const pages: {
      num: number;
      text: string;
      sparse: boolean;
      rotated: boolean;
    }[] = [];
    for (let num = 1; num <= doc.numPages; num++) {
      signal?.throwIfAborted();
      const page = await doc.getPage(num),
        content = await page.getTextContent();
      if (content.items.length > 20000) throw new DocumentLimitError();
      const view = page.getViewport({ scale: 1 });
      if (
        view.height / Math.max(view.width, 1) > 10 ||
        view.width / Math.max(view.height, 1) > 10
      )
        throw new DocumentLimitError();
      const rotated = content.items.some(
        (item) => "str" in item && Math.abs(item.transform[1]) > 0.1,
      );
      const rows: {
        y: number;
        items: {
          x: number;
          width: number;
          text: string;
        }[];
      }[] = [];
      const items = content.items
        .flatMap((item) => ("str" in item && item.str.trim() ? [item] : []))
        .sort(
          (a, b) =>
            b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
        );
      for (const item of items) {
        const y = item.transform[5],
          x = item.transform[4];
        let row: (typeof rows)[number] | undefined = rows[rows.length - 1];
        if (row && Math.abs(row.y - y) >= 4) row = undefined;
        if (!row) {
          row = { y, items: [] };
          rows.push(row);
        }
        row.items.push({ x, width: item.width, text: item.str });
      }
      rows.sort((a, b) => b.y - a.y);
      // A sustained vertical gutter indicates independent columns. Tables have
      // many full-width body lines crossing their cell gaps, so fail this test.
      const splits = rows.flatMap((row) =>
        row.items.slice(1).flatMap((item, i) => {
          const previous = row.items[i],
            gap = item.x - previous.x - previous.width;
          return gap > 25 ? [(item.x + previous.x + previous.width) / 2] : [];
        }),
      );
      const split = splits.find((x) => {
        if (x < view.width * 0.22 || x > view.width * 0.72) return false;
        const crossing = items.filter(
          (i) => i.transform[4] < x && i.transform[4] + i.width > x + 3,
        ).length;
        const left = items.filter(
          (i) => i.transform[4] < x && i.transform[4] + i.width <= x + 3,
        ).length;
        const right = items.filter((i) => i.transform[4] >= x).length;
        const paired = rows.filter(
          (r) => r.items.some((i) => i.x < x) && r.items.some((i) => i.x >= x),
        ).length;
        return (
          crossing <= Math.max(5, items.length * 0.05) &&
          left >= 12 &&
          right >= 12 &&
          paired >= 4
        );
      });
      let orderedRows = rows;
      if (split !== undefined) {
        const firstPair = rows.findIndex(
          (r) =>
            r.items.some((i) => i.x < split) &&
            r.items.some((i) => i.x >= split),
        );
        const header = rows.slice(0, firstPair),
          body = rows.slice(firstPair).filter((r) => r.y >= 55),
          footer = rows.filter((r) => r.y < 55);
        const lane = (left: boolean) =>
          body
            .map((r) => ({
              ...r,
              items: r.items.filter((i) => (left ? i.x < split : i.x >= split)),
            }))
            .filter((r) => r.items.length);
        orderedRows = [...header, ...lane(true), ...lane(false), ...footer];
      }
      const text = orderedRows
        .map((row) => {
          row.items.sort((a, b) => a.x - b.x);
          let result = "",
            end: number | undefined;
          for (const item of row.items) {
            const gap = end === undefined ? 0 : item.x - end;
            result +=
              (end === undefined
                ? ""
                : gap > 20
                  ? "\t"
                  : gap > 2 && !result.endsWith(" ")
                    ? " "
                    : "") + item.text;
            end = item.x + item.width;
          }
          return result;
        })
        .join("\n");
      totalCharacters += text.length;
      if (totalCharacters > 200000) throw new DocumentLimitError();
      // Sparse readable headers can sit over a large scanned body. Check image operators
      // only in this narrow case; avoid converting embedded images into buffers.
      let sparse = false;
      if ((text.match(/\p{L}/gu) ?? []).length < 160) {
        const operators = await page.getOperatorList();
        const { OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
        sparse = operators.fnArray.some((op) =>
          [
            OPS.paintImageXObject,
            OPS.paintInlineImageXObject,
            OPS.paintImageMaskXObject,
          ].includes(op),
        );
      }
      pages.push({ num, text, sparse, rotated });
      page.cleanup();
    }
    return { total: doc.numPages, pages };
  } finally {
    signal?.removeEventListener("abort", abort);
    await task.destroy();
  }
}
