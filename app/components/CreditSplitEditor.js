"use client";

import { normalizeSplits, splitError, splitsTotal } from "../../lib/splits";

const nameOf = (u) => (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email);

// Shares a job between people. On its own a job belongs entirely to its
// salesperson / owner, so there's nothing to set until a second person is
// added -- that's when the percentages appear.
export default function CreditSplitEditor({ idPrefix, users = [], value = [], onChange, ownerId, ownerLabel = "the salesperson" }) {
  const rows = value || [];
  const total = splitsTotal(rows);
  // Nothing is wrong yet while a row is still waiting for a name.
  const incomplete = rows.some(r => !r.userId);
  const error = incomplete ? "" : splitError(rows);
  const active = users.filter(u => !u.disabled || rows.some(r => r.userId === u.id));
  const sorted = [...active].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const update = (i, patch) => onChange(rows.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  const remaining = Math.max(0, Math.round((100 - total) * 10) / 10);

  // Adding the first person splits the job with whoever owns it today.
  const addPerson = () => {
    if (rows.length === 0) {
      onChange([{ userId: ownerId || "", percent: 50 }, { userId: "", percent: 50 }]);
    } else {
      onChange([...rows, { userId: "", percent: remaining }]);
    }
  };

  const showPercents = rows.length > 1;

  return (
    <div className="credit-split">
      {rows.length === 0 ? (
        <>
          <p className="private-note-hint" style={{ margin: "0 0 8px" }}>
            This job counts entirely for {ownerLabel}. Add someone to share it.
          </p>
          <button type="button" className="btn btn-secondary" onClick={addPerson}>+ Share with someone</button>
        </>
      ) : (
        <>
          {rows.map((row, i) => (
            <div key={i} className={`credit-split-row ${showPercents ? "" : "no-percent"}`}>
              <div>
                <label className="field-label" htmlFor={`${idPrefix}-person-${i}`}>Person</label>
                <select
                  id={`${idPrefix}-person-${i}`}
                  className="field"
                  value={row.userId || ""}
                  onChange={e => update(i, { userId: e.target.value })}
                >
                  <option value="">Select person...</option>
                  {sorted.map(u => <option key={u.id} value={u.id}>{nameOf(u)}</option>)}
                </select>
              </div>
              {showPercents && (
                <div>
                  <label className="field-label" htmlFor={`${idPrefix}-percent-${i}`}>Share</label>
                  <div className="percent-field">
                    <input
                      id={`${idPrefix}-percent-${i}`}
                      className="field"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      inputMode="numeric"
                      value={row.percent ?? ""}
                      onChange={e => update(i, { percent: e.target.value === "" ? "" : Number(e.target.value) })}
                    />
                    <span className="percent-suffix" aria-hidden="true">%</span>
                  </div>
                </div>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => onChange(rows.filter((_, x) => x !== i))}>Remove</button>
            </div>
          ))}

          <div className="credit-split-foot">
            <button type="button" className="btn btn-secondary" onClick={addPerson}>+ Add person</button>
            {showPercents && !incomplete && (
              <span className={`credit-split-total ${error ? "is-error" : ""}`}>
                {Math.round(total * 10) / 10}% of 100%
              </span>
            )}
            {incomplete && <span className="credit-split-total">Pick who shares this job</span>}
          </div>

          {error && <p className="settings-status is-error" style={{ marginBottom: 0 }}>{error}</p>}
          {!error && normalizeSplits(rows).length > 1 && (
            <p className="private-note-hint" style={{ marginBottom: 0 }}>
              Everyone here works the job: it shows on their My Projects and in their alerts, and their share of its value counts toward their numbers.
            </p>
          )}
        </>
      )}
    </div>
  );
}
