"use client";

// A confirmation step for consequential admin actions. Only closes through
// its two buttons -- no backdrop click or Escape -- so nothing is confirmed
// or cancelled by accident.
export default function ConfirmDialog({ title, children, confirmLabel = "Confirm", danger = false, busy = false, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay confirm-overlay">
      <div className="modal-card confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h3 id="confirm-title" className="modal-title">{title}</h3>
        <div className="confirm-body">{children}</div>
        <div className="modal-actions confirm-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`} disabled={busy} onClick={onConfirm}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
