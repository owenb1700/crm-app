"use client";

import { useState } from "react";
import { exportProjects, exportPipeline, exportPastProjects, exportMyReminders, personName, canExportPerson } from "../../lib/personalExport";
import ExportButtons from "./ExportButtons";

const FORMAT_NAMES = { csv: "CSV", xlsx: "Excel", pdf: "PDF" };

// Export My Data (target = viewer) or, for Estimating and Admin, one
// person's data (target = someone else, never an admin). Which files are
// offered -- and what "notes" means -- depends on which of those it is.
export default function ExportDataModal({ viewer, target, onClose }) {
  const isSelf = !target || target.id === viewer.id;
  const who = isSelf ? viewer : target;
  const allowed = canExportPerson(viewer, who);
  const [status, setStatus] = useState(null); // { ok, message }
  const [includeNotes, setIncludeNotes] = useState(false);

  const files = [
    { key: "projects", label: "Projects", desc: isSelf ? "Active projects you own or collaborate on" : "Active projects they own or collaborate on", run: exportProjects, notes: true },
    { key: "pipeline", label: "Pipeline", desc: isSelf ? "Entries you own, are assigned to, or track" : "Entries they own, are assigned to, or track", run: exportPipeline, notes: true },
    { key: "past", label: "Past projects", desc: "Closed projects and resolved pipeline entries", run: exportPastProjects, notes: true },
    ...(isSelf ? [{ key: "reminders", label: "Reminders", desc: "Your reminders and personal pipeline alerts", run: exportMyReminders }] : [])
  ];

  const run = async (file, format) => {
    setStatus(null);
    try {
      const withNotes = includeNotes && file.notes;
      const count = await file.run({ target: who, viewer, format, includeNotes: withNotes });
      setStatus({ ok: true, message: `${file.label}${withNotes ? " with notes" : ""} downloaded as ${FORMAT_NAMES[format]} (${count} ${count === 1 ? "row" : "rows"}).` });
    } catch (err) {
      setStatus({ ok: false, message: `Couldn't export ${file.label.toLowerCase()}: ${err.message}` });
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card export-modal" role="dialog" aria-labelledby="export-title" onClick={e => e.stopPropagation()}>
        <div className="export-modal-head">
          <div>
            <h3 id="export-title" className="modal-title" style={{ margin: 0 }}>{isSelf ? "Export My Data" : "Export Data"}</h3>
            <p className="export-modal-who">{personName(who)}</p>
          </div>
          <button className="modal-close" style={{ position: "static" }} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!allowed ? (
          <p className="settings-status is-error" style={{ margin: "16px 0 4px" }}>
            {who.role === "admin" ? "An admin's data can only be exported by that admin." : "You don't have permission to export this person's data."}
          </p>
        ) : (
          <>
            <label className="export-notes-toggle" htmlFor="export-include-notes">
              <input
                id="export-include-notes"
                type="checkbox"
                checked={includeNotes}
                onChange={e => setIncludeNotes(e.target.checked)}
              />
              <span>
                <strong>Include notes</strong>
                <span className="export-row-desc">
                  {isSelf
                    ? "Adds current and earlier notes to Projects, Pipeline, and Past projects."
                    : "Adds notes only from their projects that you collaborate on. Anything else stays blank."}
                </span>
              </span>
            </label>

            <ul className="export-list">
              {files.map(f => (
                <li key={f.key} className="export-row">
                  <div className="export-row-text">
                    <div className="export-row-label">{f.label}</div>
                    <div className="export-row-desc">{f.desc}</div>
                  </div>
                  <ExportButtons label={f.label} onExport={(format) => run(f, format)} />
                </li>
              ))}
            </ul>
            {!isSelf && (
              <p className="export-modal-note">Their other private notes and their reminders are never included.</p>
            )}
            {status && <p className={`settings-status ${status.ok ? "is-ok" : "is-error"}`}>{status.message}</p>}
          </>
        )}
      </div>
    </div>
  );
}
