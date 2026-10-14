"use client";
import { useEffect, useState } from "react";
import { useCan } from "../workspace-access";
import StatusBadge from "../status-badge";
type Batch = {
  id: string;
  name: string;
  status: string;
  totalFiles: number;
  processedFiles: number;
  createdAt: string;
};
export default function BatchesPage() {
  const can = useCan();
  const [items, setItems] = useState<Batch[]>([]);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  async function reload() {
    try {
      const response = await fetch("/api/batches");
      if (!response.ok) throw new Error("Batch request failed");
      setItems((await response.json()).items);
      setLoadError("");
    } catch {
      setLoadError(
        "Could not refresh batches. The next automatic refresh will try again.",
      );
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    const timeout = window.setTimeout(() => void reload(), 0);
    const interval = window.setInterval(() => void reload(), 8000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);
  async function control(action: string) {
    const response = await fetch(`/api/processing/${action}`, {
      method: "POST",
    });
    setMessage(
      response.ok
        ? `Processing ${action === "start" ? "started" : action === "pause" ? "paused" : "resumed"}.`
        : "Processing control failed.",
    );
    await reload();
  }
  return (
    <main className="tool-page">
      <div className="tool-header">
        <div>
          <h1>Processing batches</h1>
          <p>Queue status updates automatically.</p>
        </div>
        {can("batches.manage") && (
          <div className="batch-controls">
            <button
              className="button button-secondary"
              onClick={() => void control("pause")}
            >
              Pause
            </button>
            <button
              className="button button-primary"
              onClick={() => void control("start")}
            >
              Start processing
            </button>
            <button
              className="button button-secondary"
              onClick={() => void control("resume")}
            >
              Resume
            </button>
          </div>
        )}
      </div>
      {message && <p>{message}</p>}
      <section className="panel table-panel">
        <div className="table-heading">
          <div>
            <h2>Batch records</h2>
            <p>Live processing progress for your uploaded batches.</p>
          </div>
        </div>
        {loadError && (
          <p className="ui-error" role="alert">
            {loadError}
          </p>
        )}
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Processing batches table"
        >
          <table>
            <thead>
              <tr>
                <th>BATCH</th>
                <th>STATUS</th>
                <th>PROGRESS</th>
                <th>CREATED</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((batch) => (
                <tr key={batch.id}>
                  <td>
                    <b>{batch.name}</b>
                  </td>
                  <td>
                    <StatusBadge status={batch.status} />
                  </td>
                  <td>
                    {batch.processedFiles.toLocaleString()} /{" "}
                    {batch.totalFiles.toLocaleString()}
                  </td>
                  <td>{new Date(batch.createdAt).toLocaleString()}</td>
                  <td>
                    {can("batches.manage") &&
                      !["COMPLETED", "CANCELLED"].includes(batch.status) && (
                        <button
                          className="clear-button"
                          onClick={async () => {
                            const response = await fetch(
                              `/api/batches/${batch.id}/cancel`,
                              { method: "POST" },
                            );
                            setMessage(
                              response.ok
                                ? "Batch cancelled. Pending and active resumes were cancelled."
                                : "Could not cancel this batch.",
                            );
                            await reload();
                          }}
                        >
                          Cancel
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loaded ? (
            <div className="table-state" role="status">
              Loading batches…
            </div>
          ) : (
            !loadError &&
            items.length === 0 && (
              <div className="empty-search">
                <strong>No batches uploaded yet</strong>
                <p>Import resumes to create a processing batch.</p>
              </div>
            )
          )}
        </div>
      </section>
    </main>
  );
}
