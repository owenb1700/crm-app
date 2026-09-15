"use client";

import { useState } from "react";
import { exportProjects, exportPipeline, exportPastProjects, exportNotes, exportMyReminders, personName } from "../../lib/personalExport";
import ExportButtons from "./ExportButtons";

// Export My Data (target = viewer) or, for Estimating and Admin, one
// person's data (target = someone else). Which files are offered -- and
// what "notes" means -- depends on which of those it is.
export default function ExportDataModal({ viewer, target, onClose }) {
  const isSelf = !target || target.id === viewer.id;
  const who = isSelf ? viewer : target;
  const [busy, setBusy] = useState(null); // { key, format } while a file is being built
  const [status, setStatus] = useState(null); // { ok, message }

  const files = [
    { key: "projects", label: isSelf ? "My projects" : "Projects", desc: "Active projects owned or collaborated on", run: exportProjects },
    { key: "pipeline", label: isSelf ? "My pipeline" : "Pipeline", desc: "Entries where they're the owner, salesperson, or point person, or tracking it", run: exportPipeline },
    { key: "past", label: isSelf ? "My past projects" : "Past projects", desc: "Closed projects and resolved pipeline entries", run: exportPastProjects },
    {
      key: "notes",
      label: isSelf ? "My notes" : "Notes (shared projects only)",
      desc: isSelf
        ? "Current and earlier notes on your projects and pipeline entries"
        : `Only notes from ${personName(who)}'s projects that you collaborate on. Their other private notes are never included.`,
      run: exportNotes
    },
    ...(isSelf ? [{ key: "reminders", label: "My reminders", desc: "Your reminders and personal pipeline alerts", run: exportMyReminders }] : [])
  ];

  const run = async (file, format) => {
    setBusy({ key: file.key, format });
    setStatus(null);
    try {
      const count = await file.run({ target: who, viewer, format });
      setStatus({ ok: true, message: `${file.label}: downloaded ${count} ${count === 1 ? "row" : "rows"} as ${format === "xlsx" ? "Excel" : "CSV"}.` });
    } catch (err) {
      setStatus({ ok: false, message: `Couldn't export ${file.label.toLowerCase()}: ${err.message}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-labelledby="export-title" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h3 id="export-title" className="modal-title">{isSelf ? "Export My Data" : `Export ${personName(who)}'s Data`}</h3>
        <p className="modal-subtitle" style={{ marginBottom: 12 }}>
          Download each file as CSV or Excel. Both open in Excel and Google Sheets; the Excel version has filters and a frozen header row.
        </p>

        <div className="export-list">
          {files.map(f => (
            <div key={f.key} className="export-row">
              <div>
                <div className="export-row-label">{f.label}</div>
                <div className="export-row-desc">{f.desc}</div>
              </div>
              <ExportButtons
                label={f.label}
                disabled={!!busy}
                busyFormat={busy?.key === f.key ? busy.format : null}
                onExport={(format) => run(f, format)}
              />
            </div>
          ))}
        </div>

        {status && <p className={`settings-status ${status.ok ? "is-ok" : "is-error"}`}>{status.message}</p>}
      </div>
    </div>
  );
}
