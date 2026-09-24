"use client";

// The one way the site offers something it has remembered.
//
// Two rules, and they hold everywhere this is used:
//
//   1. It never overwrites what somebody typed. A filled field is left
//      alone and the suggestion sits underneath, waiting to be taken.
//   2. It always says where it came from. A value that arrived by itself
//      with no explanation is one nobody can check, and a wrong one would
//      quietly travel into every job that followed.
//
// An empty field is filled in for you -- that's the point of the feature --
// but it says so, and one click puts it back.
export default function Suggested({ suggestion, applied, onUse, onUndo, format }) {
  if (!suggestion) return null;
  const shown = format ? format(suggestion.value) : String(suggestion.value ?? "");

  if (applied) {
    return (
      <p className="private-note-hint" style={{ marginTop: 4 }}>
        Filled in {suggestion.source}.{" "}
        {onUndo && (
          <button type="button" className="link-muted matching-select-link" onClick={onUndo}>
            Undo
          </button>
        )}
      </p>
    );
  }

  return (
    <p className="private-note-hint" style={{ marginTop: 4 }}>
      Suggested: <strong>{shown}</strong> — {suggestion.source}.{" "}
      {onUse && (
        <button type="button" className="link-muted matching-select-link" onClick={onUse}>
          Use this
        </button>
      )}
    </p>
  );
}

// A heavier version for a whole block of remembered detail -- the building
// engineer and the equipment on a known address -- where the offer is
// "fill several fields at once" rather than one value.
export function SuggestedBlock({ title, source, children, onUse, onDismiss, applied }) {
  return (
    <div className="review-banner" style={{ display: "block", marginBottom: 12 }}>
      <div style={{ marginBottom: 6 }}>
        <strong>{title}</strong>
        {source ? <span className="private-note-hint"> — {source}</span> : null}
      </div>
      {children}
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        {!applied && onUse && (
          <button type="button" className="btn btn-secondary" onClick={onUse}>Use this</button>
        )}
        {applied && <span className="private-note-hint">Filled in below — change anything that has moved on.</span>}
        {onDismiss && (
          <button type="button" className="link-muted matching-select-link" onClick={onDismiss}>
            {applied ? "Undo" : "No thanks"}
          </button>
        )}
      </div>
    </div>
  );
}
