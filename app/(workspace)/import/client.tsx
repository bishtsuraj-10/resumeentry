"use client";
import Link from "next/link";

import { useRef, useState } from "react";

import { useCan } from "../workspace-access";

const supported = ".pdf,.docx,.jpg,.jpeg,.png";
export default function ImportPage() {
  const can = useCan();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [batchSize, setBatchSize] = useState(100);
  const [batchName, setBatchName] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    setFiles((current) => [
      ...current,
      ...Array.from(incoming).filter((file) =>
        /\.(pdf|docx?|jpe?g|png)$/i.test(file.name),
      ),
    ]);
  }
  async function upload() {
    if (!files.length || busy) return;
    setBusy(true);
    setProgress(0);
    setMessage("");
    let accepted = 0;
    let queued = 0;
    let duplicates = 0;
    let rejected = 0;
    try {
      const maxRequestBytes = 75 * 1024 * 1024;
      for (
        let groupStart = 0;
        groupStart < files.length;
        groupStart += batchSize
      ) {
        const groupEnd = Math.min(files.length, groupStart + batchSize);
        let batchId: string | undefined;
        for (let index = groupStart; index < groupEnd; ) {
          const batch: File[] = [];
          let batchBytes = 0;
          while (
            index < groupEnd &&
            batch.length < 50 &&
            batchBytes + files[index].size <= maxRequestBytes
          ) {
            batch.push(files[index]);
            batchBytes += files[index].size;
            index += 1;
          }
          if (!batch.length)
            throw new Error(
              "A selected file exceeds the per-request upload limit.",
            );
          const data = new FormData();
          data.set("batchName", batchName || "Resume import");
          data.set("batchSize", String(batchSize));
          if (batchId) data.set("batchId", batchId);
          data.set("complete", String(index >= groupEnd));
          batch.forEach((file) => data.append("files", file, file.name));
          const response = await fetch("/api/resumes/upload", {
            method: "POST",
            body: data,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Upload failed.");
          batchId = result.batchId;
          accepted += result.accepted;
          queued += result.queued;
          duplicates += result.duplicates;
          rejected += result.rejected.length;
          setProgress(Math.round((index / files.length) * 100));
        }
      }
      setMessage(
        `${accepted.toLocaleString()} resume records added; ${queued.toLocaleString()} queued${duplicates ? ` · ${duplicates.toLocaleString()} exact duplicates marked` : ""}${rejected ? ` · ${rejected.toLocaleString()} rejected` : ""}.`,
      );
      setFiles([]);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Upload failed. Retry the remaining files.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="tool-page">
      <div className="tool-header">
        <div>
          <h1>Import resumes</h1>
          <p>
            Upload resume files in manageable batches. Processing runs in the
            background.
          </p>
        </div>
        {can("batches.view") && (
          <Link className="button button-secondary" href="/batches">
            View batches
          </Link>
        )}
      </div>
      <section className="tool-panel">
        <label className="tool-label">
          Batch name
          <input
            className="tool-input"
            value={batchName}
            onChange={(event) => setBatchName(event.target.value)}
            placeholder="e.g. Engineering candidates — October"
          />
        </label>
        <label className="tool-label batch-size">
          Files per batch
          <select
            className="tool-input"
            value={batchSize}
            onChange={(event) => setBatchSize(Number(event.target.value))}
          >
            {[100, 500, 1000, 5000].map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </label>
        <div
          className={`drop-zone ${dragging ? "is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
        >
          <span className="upload-symbol">↑</span>
          <b>Drop resume files here</b>
          <span>PDF, DOCX, JPG, PNG · Up to 20 MB per file</span>
          <div className="browse-actions">
            <button
              className="button button-secondary"
              onClick={() => input.current?.click()}
            >
              Browse files
            </button>
            <button
              className="button button-secondary"
              onClick={() => folderInput.current?.click()}
            >
              Choose folder
            </button>
          </div>
          <input
            ref={input}
            type="file"
            accept={supported}
            multiple
            hidden
            onChange={(event) => addFiles(event.target.files)}
          />
          <input
            ref={(element) => {
              folderInput.current = element;
              element?.setAttribute("webkitdirectory", "");
            }}
            type="file"
            accept={supported}
            multiple
            hidden
            onChange={(event) => addFiles(event.target.files)}
          />
        </div>
        <div className="import-summary">
          <div>
            <b>{files.length.toLocaleString()} files selected</b>
            <span>File data is uploaded sequentially in small chunks.</span>
          </div>
          <button
            className="clear-button"
            disabled={!files.length || busy}
            onClick={() => setFiles([])}
          >
            Clear selection
          </button>
        </div>
        {files.length > 0 && (
          <div className="selected-files">
            {files.slice(0, 8).map((file, index) => (
              <div className="selected-file" key={`${file.name}-${index}`}>
                <span>▤</span>
                <b>{file.name}</b>
                <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
              </div>
            ))}
            {files.length > 8 && <p>and {files.length - 8} more files…</p>}
          </div>
        )}
        {busy && (
          <div className="upload-progress">
            <div>
              <span>Uploading and queuing batches</span>
              <b>{progress}%</b>
            </div>
            <div className="progress-line">
              <i style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        {message && (
          <p className="import-message" role="status">
            {message}
          </p>
        )}
        <div className="import-actions">
          <span>
            Resumes are private and access follows workspace permissions.
          </span>
          <button
            className="button button-primary"
            disabled={!files.length || busy}
            onClick={() => void upload()}
          >
            {busy
              ? "Uploading…"
              : `Upload ${files.length ? files.length.toLocaleString() : "files"}`}
          </button>
        </div>
      </section>
    </main>
  );
}
