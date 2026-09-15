"use client";

import { useEffect, useId, useRef, useState } from "react";

const FORMATS = [
  { key: "csv", label: "CSV", hint: "Plain spreadsheet file" },
  { key: "xlsx", label: "Excel", hint: "Filters and a frozen header row" },
  { key: "pdf", label: "PDF", hint: "Printable table" }
];

// One "Export" dropdown, used everywhere the app offers a download.
// `onExport` receives "csv", "xlsx", or "pdf" (and may return a promise).
export default function ExportButtons({ onExport, disabled = false, busyFormat = null, label, buttonText = "Export" }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(null);
  const wrapRef = useRef(null);
  const menuId = useId();
  const busy = busyFormat || running;

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = async (format) => {
    setOpen(false);
    setRunning(format);
    try {
      await onExport(format);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="export-menu" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-secondary btn-small export-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label ? `Export ${label}` : "Export"}
        disabled={disabled || !!busy}
        onClick={() => setOpen(o => !o)}
      >
        {busy ? `Preparing ${FORMATS.find(f => f.key === busy)?.label || ""}…` : <>{buttonText} <span aria-hidden="true">▾</span></>}
      </button>
      {open && (
        <div className="export-menu-list" role="menu" id={menuId}>
          {FORMATS.map(f => (
            <button key={f.key} type="button" role="menuitem" className="export-menu-item" onClick={() => choose(f.key)}>
              <span className="export-menu-item-label">{f.label}</span>
              <span className="export-menu-item-hint">{f.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
