"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

export default function PdfPreview({
  id,
  fileType,
  allowed,
}: {
  id: string;
  fileType: string;
  allowed: boolean;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<string>("fit");
  const [panelWidth, setPanelWidth] = useState(0);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [rendering, setRendering] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scrollPanel = useRef<HTMLDivElement>(null);
  const href = `/api/resumes/${encodeURIComponent(id)}/file`;
  useEffect(() => {
    if (!allowed || fileType.toLowerCase() !== "pdf") return;
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    void (async () => {
      try {
        const pdf = await import("pdfjs-dist");
        if (controller.signal.aborted) return;
        pdf.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const response = await fetch(href, {
          signal: controller.signal,
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok)
          throw new Error(`Original PDF unavailable (${response.status}).`);
        if (!response.headers.get("content-type")?.includes("application/pdf"))
          throw new Error("The original endpoint did not return a PDF.");
        const data = new Uint8Array(await response.arrayBuffer());
        if (controller.signal.aborted) return;
        const task = pdf.getDocument({ data, isEvalSupported: false });
        dispose = () => {
          void task.destroy();
        };
        const loaded = await task.promise;
        if (!controller.signal.aborted) {
          setDocument(loaded);
          setPage(1);
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not preview the PDF.",
          );
      }
    })();
    return () => {
      controller.abort();
      dispose?.();
    };
  }, [href, allowed, fileType, retry]);
  useEffect(() => {
    const panel = scrollPanel.current;
    if (!panel) return;
    const observer = new ResizeObserver(() => setPanelWidth(Math.max(1, panel.clientWidth - 32)));
    observer.observe(panel);
    return () => observer.disconnect();
  }, [document, error]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (!cancelled) setRendering(true);
        if (cancelled || !canvas.current) return;
        const original = pdfPage.getViewport({ scale: 1 });
        if (zoom === "fit" && !panelWidth) return;
        const scale = zoom === "fit" ? panelWidth / original.width : Number(zoom) / 100;
        const viewport = pdfPage.getViewport({ scale });
        const target = canvas.current;
        const ratio = window.devicePixelRatio || 1;
        target.width = Math.ceil(viewport.width * ratio);
        target.height = Math.ceil(viewport.height * ratio);
        target.style.width = `${viewport.width}px`;
        target.style.height = `${viewport.height}px`;
        const task = pdfPage.render({
          canvas: target,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        stop = () => task.cancel();
        await task.promise;
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Could not render this page.",
          );
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [document, page, zoom, panelWidth]);
  return (
    <aside id="document-preview" className="candidate-document" aria-label="Original document">
      <div className="document-heading">
        <h2>Original document</h2>
        {allowed && (
          <a
            className="back-link"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in new tab ↗
          </a>
        )}
      </div>
      {!allowed ? (
        <p className="candidate-muted">
          Document download permission is required to preview the original.
        </p>
      ) : fileType.toLowerCase() !== "pdf" ? (
        <p className="candidate-muted">
          Preview is available for PDF files. Open the original document to
          download this {fileType.toUpperCase()} file.
        </p>
      ) : (
        <>
          <div className="pdf-toolbar" aria-label="PDF controls">
            <button
              className="button button-secondary"
              aria-label="Previous PDF page"
              disabled={!document || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ←
            </button>
            <label>
              Page{" "}
              <input
                aria-label="PDF page"
                className="tool-input"
                type="number"
                min={1}
                max={document?.numPages ?? 1}
                value={page}
                disabled={!document}
                onChange={(e) =>
                  setPage(
                    Math.min(
                      document?.numPages ?? 1,
                      Math.max(1, Number(e.target.value) || 1),
                    ),
                  )
                }
              />{" "}
              / {document?.numPages ?? "…"}
            </label>
            <button
              className="button button-secondary"
              aria-label="Next PDF page"
              disabled={!document || page >= document.numPages}
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </button>
            <label>
              Zoom{" "}
              <select
                className="tool-input"
                aria-label="PDF zoom"
                value={zoom}
                onChange={(e) => setZoom(e.target.value)}
              >
                <option value="fit">Fit width</option>
                {[50, 75, 100, 125, 150, 200].map((n) => (
                  <option key={n} value={n}>
                    {n}%
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error ? (
            <div className="document-state" role="alert">
              <p>{error}</p>
              <button
                className="button button-secondary"
                onClick={() => {
                  setError("");
                  setDocument(null);
                  setRetry((n) => n + 1);
                }}
              >
                Retry PDF preview
              </button>
              <p>You can also open the original using the link above.</p>
            </div>
          ) : (
            <>
              <p className="pdf-render-status" role="status">
                {!document
                  ? "Loading private PDF…"
                  : rendering
                    ? "Rendering page…"
                    : `Page ${page} of ${document.numPages}`}
              </p>
              <div
                ref={scrollPanel}
                className="pdf-scroll"
                tabIndex={0}
                aria-label="PDF page preview"
              >
                <canvas
                  ref={canvas}
                  role="img"
                  aria-label={`Original PDF, page ${page}. Open the original for selectable text and document accessibility.`}
                />
              </div>
            </>
          )}
        </>
      )}
    </aside>
  );
}
