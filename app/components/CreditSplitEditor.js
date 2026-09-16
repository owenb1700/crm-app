"use client";

import { normalizeSplits, splitError, splitsTotal } from "../../lib/splits";

const nameOf = (u) => (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email);

// Shares a job between people by percentage. Leave it empty and the job
// counts entirely for its salesperson / owner, as usual.
export default function CreditSplitEditor({ idPrefix, users = [], value = [], onChange, ownerLabel = "the salesperson" }) {
  const rows = value.length ? value : [];
  const total = splitsTotal(rows);
  const error = splitError(rows);
  const active = users.filter(u => !u.disabled || rows.some(r => r.userId === u.id));

  const update = (i, patch) => onChange(rows.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  const remaining = Math.max(0, Math.round((100 - total) * 10) / 10);

  return (
    <div className="credit-split">
      {rows.length === 0 && (
        <p className="private-note-hint" style={{ margin: "0 0 8px" }}>
          Not split — the whole job counts for {ownerLabel}.
        </p>
      )}

      {rows.map((row, i) => (
        <div key={i} className="credit-split-row">
          <div>
            <label className="field-label" htmlFor={`${idPrefix}-person-${i}`}>Person</label>
            <select
              id={`${idPrefix}-person-${i}`}
              className="field"
              value={row.userId || ""}
              onChange={e => update(i, { userId: e.target.value })}
            >
              <option value="">Select person...</option>
              {active
                .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
                .map(u => <option key={u.id} value={u.id}>{nameOf(u)}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor={`${idPrefix}-percent-${i}`}>Share %</label>
            <input
              id={`${idPrefix}-percent-${i}`}
              className="field"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={row.percent ?? ""}
              onChange={e => update(i, { percent: e.target.value === "" ? "" : Number(e.target.value) })}
            />
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => onChange(rows.filter((_, x) => x !== i))}>Remove</button>
        </div>
      ))}

      <div className="credit-split-foot">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onChange([...rows, { userId: "", percent: rows.length ? remaining : 100 }])}
        >
          + Add person
        </button>
        {rows.length > 0 && (
          <span className={`credit-split-total ${error ? "is-error" : ""}`}>
            {Math.round(total * 10) / 10}% of 100%
          </span>
        )}
      </div>

      {error && <p className="settings-status is-error" style={{ marginBottom: 0 }}>{error}</p>}
      {!error && normalizeSplits(rows).length > 0 && (
        <p className="private-note-hint" style={{ marginBottom: 0 }}>
          Everyone here works the job: it shows on their My Projects and in their alerts, and counts toward their numbers by their share.
        </p>
      )}
    </div>
  );
}
