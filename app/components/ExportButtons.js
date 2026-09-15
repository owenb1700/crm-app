"use client";

// A CSV + Excel pair, used everywhere the app offers a download. `onExport`
// receives "csv" or "xlsx".
export default function ExportButtons({ onExport, disabled = false, busyFormat = null, label }) {
  return (
    <div className="export-buttons" role="group" aria-label={label ? `Download ${label}` : "Download"}>
      <button type="button" className="btn btn-secondary btn-small" disabled={disabled} onClick={() => onExport("csv")}>
        {busyFormat === "csv" ? "Preparing…" : "⬇ CSV"}
      </button>
      <button type="button" className="btn btn-secondary btn-small" disabled={disabled} onClick={() => onExport("xlsx")}>
        {busyFormat === "xlsx" ? "Preparing…" : "⬇ Excel"}
      </button>
    </div>
  );
}
