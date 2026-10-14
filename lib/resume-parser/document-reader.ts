import { createWorker, PSM } from "tesseract.js";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import path from "node:path";
import { readFile, stat, access } from "node:fs/promises";
import type { ResumeParser } from "./basic";
import { assessTextQuality } from "./text-normalizer";
import { readPdfLayout } from "./pdf-layout";
import {
  DocumentLimitError,
  DocumentTimeoutError,
  checkDocxExpansion,
  checkImageDimensions,
} from "./document-limits";
export { DocumentLimitError, DocumentTimeoutError } from "./document-limits";
export interface DocumentResult {
  text: string;
  usedOcr: boolean;
  ocrPages: number;
  pageCount: number;
  warnings: string[];
  durationMs: number;
}
export interface ReaderOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  maxPages?: number;
}
function htmlText(html: string) {
  return html
    .replace(
      /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi,
      (_, cell: string) => cell.replace(/<\/(?:p|h[1-6])>/gi, " ") + "\t",
    )
    .replace(
      /<a\b[^>]*href="(https?:[^"<>]+)"[^>]*>([\s\S]*?)<\/a>/g,
      "$2 ($1)",
    )
    .replace(/<\/(?:p|h[1-6]|tr|li)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, (v) => {
      const map: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
        "&nbsp;": " ",
      };
      if (map[v]) return map[v];
      const code = v.startsWith("&#x")
        ? parseInt(v.slice(3, -1), 16)
        : parseInt(v.slice(2, -1), 10);
      return Number.isFinite(code) && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    });
}
export class LocalResumeParser implements ResumeParser {
  canParse(fileType: string) {
    return [".pdf", ".docx", ".jpg", ".jpeg", ".png"].includes(
      fileType.toLowerCase(),
    );
  }
  async extractText(
    filePath: string,
    options: ReaderOptions = {},
  ): Promise<DocumentResult> {
    const started = Date.now();
    const extension = path.extname(filePath).toLowerCase();
    if (!this.canParse(extension))
      throw new Error(`Unsupported resume format: ${extension || "unknown"}`);
    const timeoutMs = options.timeoutMs ?? 120000;
    const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
    const maxPages = options.maxPages ?? 25;
    if ((await stat(filePath)).size > maxBytes) throw new DocumentLimitError();
    let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
    let pdf: PDFParse | undefined;
    let timedOut = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      options.signal?.throwIfAborted();
      if (timedOut) throw new DocumentTimeoutError();
    };
    const warnings: string[] = [];
    let ocrPages = 0,
      pageCount = 1;
    const recognize = async (data: string | Buffer) => {
      check();
      if (!worker) {
        // Provision language data locally: no implicit language-model download.
        const langPath = path.resolve(
          process.env.OCR_LANG_PATH ??
            process.env.TESSDATA_PATH ??
            process.cwd(),
        );
        await access(path.join(langPath, "eng.traineddata"));
        worker = await createWorker("eng", 1, {
          langPath,
          gzip: false,
          cacheMethod: "none",
        });
        if (timedOut || options.signal?.aborted) await worker.terminate();
        check();
        // Automatic segmentation separates display-size headers from body
        // paragraphs. Tesseract.js defaults to a single block, which can merge
        // a name with a page footer and lose it during text normalization.
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
      }
      const result = await worker.recognize(data);
      check();
      ocrPages++;
      if (result.data.confidence < 70) warnings.push("LOW_OCR_CONFIDENCE");
      return result.data.text;
    };
    const cancel = () => {
      controller.abort();
      void worker?.terminate().catch(() => {});
      void pdf?.destroy().catch(() => {});
    };
    let rejectAbort: (error: unknown) => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
      timer = setTimeout(() => {
        timedOut = true;
        cancel();
        reject(new DocumentTimeoutError());
      }, timeoutMs);
    });
    const abort = () => {
      cancel();
      rejectAbort(
        options.signal?.reason ?? new Error("Document extraction aborted"),
      );
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const text = await Promise.race([
        (async () => {
          check();
          if (extension === ".docx") {
            const bytes = await readFile(filePath);
            checkDocxExpansion(bytes);
            let embeddedImages = false;
            const output = await mammoth.convertToHtml(
              { buffer: bytes },
              {
                convertImage: mammoth.images.imgElement(async () => {
                  embeddedImages = true;
                  return { src: "" };
                }),
              },
            );
            if (output.messages.length) warnings.push("DOCX_LAYOUT_WARNINGS");
            if (embeddedImages) warnings.push("DOCX_EMBEDDED_IMAGES_NOT_OCRD");
            check();
            return htmlText(output.value);
          }
          if (extension !== ".pdf") {
            checkImageDimensions(await readFile(filePath));
            return recognize(filePath);
          }
          const bytes = await readFile(filePath);
          const result = await readPdfLayout(
            bytes,
            maxPages,
            controller.signal,
          );
          pageCount = result.total;
          const texts: string[] = [];
          for (const page of result.pages) {
            check();
            const quality = assessTextQuality(page.text);
            if (page.rotated) warnings.push("ROTATED_TEXT_LAYOUT");
            if (quality.usable && !page.sparse && !page.rotated) {
              texts.push(page.text);
              continue;
            }
            // Render only one deficient page at a time, never all pages into memory.
            pdf ??= new PDFParse({ data: bytes });
            const image = await pdf.getScreenshot({
              partial: [page.num],
              // At oversized render scales automatic OCR segmentation can drop
              // isolated large headings despite high body-text confidence.
              // A bounded 1200px page retains names and improves memory usage.
              desiredWidth: 1200,
              imageBuffer: true,
              imageDataUrl: false,
            });
            const recovered = await recognize(Buffer.from(image.pages[0].data));
            const recoveredQuality = assessTextQuality(recovered);
            if (!recoveredQuality.usable) warnings.push("UNREADABLE_PAGE");
            texts.push(
              recoveredQuality.signals.letters > quality.signals.letters
                ? recovered
                : page.text,
            );
          }
          return texts.join("\n\f\n");
        })(),
        aborted,
      ]);
      check();
      if (text.length > 200000) throw new DocumentLimitError();
      const quality = assessTextQuality(text);
      warnings.push(...quality.warnings);
      if (/\t/.test(text)) warnings.push("LAYOUT_READING_ORDER_UNCERTAIN");
      return {
        text,
        usedOcr: ocrPages > 0,
        ocrPages,
        pageCount,
        warnings: [...new Set(warnings)],
        durationMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      await worker?.terminate().catch(() => {});
      await pdf?.destroy().catch(() => {});
    }
  }
}
