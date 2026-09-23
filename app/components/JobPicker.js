"use client";

import { useState } from "react";

// Search-as-you-type picker for attaching something to a job. `options` are
// { key, kind: "project" | "pipeline" | "part", id, label, sub }; `value`
// is the chosen option's key ("" for none).
const KIND_LABEL = { pipeline: "Pipeline", part: "Parts", project: "Project" };

export default function JobPicker({ id, options, value, onChange, placeholder = "Search projects, pipeline entries and parts..." }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const chosen = options.find(o => o.key === value);
  const q = query.trim().toLowerCase();
  const matches = (q
    ? options.filter(o => `${o.label} ${o.sub || ""}`.toLowerCase().includes(q))
    : options
  ).slice(0, 50);

  if (chosen) {
    return (
      <div className="job-picker-chosen">
        <span className={`role-badge ${chosen.kind === "pipeline" ? "role-badge-admin" : ""}`}>
          {KIND_LABEL[chosen.kind] || "Project"}
        </span>
        <span className="job-picker-chosen-name">{chosen.label}</span>
        <button type="button" className="link-muted job-picker-clear" onClick={() => onChange("")}>Remove</button>
      </div>
    );
  }

  return (
    <div className="job-picker">
      <input
        id={id}
        className="field"
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && (
        <div className="job-picker-menu" role="listbox">
          {matches.length === 0 && <div className="job-picker-empty">No matching projects or pipeline entries</div>}
          {matches.map(o => (
            <div
              key={o.key}
              role="option"
              aria-selected="false"
              className="job-picker-option"
              onMouseDown={e => {
                e.preventDefault();
                onChange(o.key);
                setQuery("");
                setOpen(false);
              }}
            >
              <span className={`role-badge ${o.kind === "pipeline" ? "role-badge-admin" : ""}`}>
                {KIND_LABEL[o.kind] || "Project"}
              </span>
              <span className="job-picker-option-text">
                <span>{o.label}</span>
                {o.sub && <span className="job-picker-option-sub">{o.sub}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
