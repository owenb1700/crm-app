"use client";

// Sorting for a list of cards, where there are no column headings to
// click: pick what to sort by, and which way round.
export default function SortPicker({ id, options, sort, onChange, label = "Sort" }) {
  const keys = Object.keys(options || {});
  if (!keys.length) return null;

  return (
    <span className="sort-picker">
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select
        id={id}
        className="field"
        style={{ marginBottom: 0 }}
        value={sort?.key || keys[0]}
        onChange={e => onChange({ ...sort, key: e.target.value })}
      >
        {keys.map(k => <option key={k} value={k}>{`${label}: ${options[k].label}`}</option>)}
      </select>
      <button
        type="button"
        className="btn btn-secondary"
        aria-label={sort?.direction === "desc" ? "Sort ascending" : "Sort descending"}
        title={sort?.direction === "desc" ? "Largest / latest first" : "Smallest / soonest first"}
        onClick={() => onChange({ ...sort, direction: sort?.direction === "desc" ? "asc" : "desc" })}
      >
        {sort?.direction === "desc" ? "▼" : "▲"}
      </button>
    </span>
  );
}
