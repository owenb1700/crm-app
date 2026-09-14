"use client";

// Filters for a whole list page (Team, Pipeline, Past Projects). Each
// filter is either a "select" ({ key, label, options: [{ value, label }] })
// or a "date" range ({ key, label, presets: [...keys of DATE_PRESETS] }).
// Values live in the page: { [key]: string } for selects ("" = any) and
// { [key]: { preset, from, to } } for dates.

const pad = (n) => String(n).padStart(2, "0");
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysFromToday = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localKey(d);
};

// Each preset returns an inclusive [from, to] range of "YYYY-MM-DD" keys;
// null on either side means open-ended.
export const DATE_PRESETS = {
  overdue: { label: "Overdue", range: () => [null, daysFromToday(-1)] },
  today: { label: "Today", range: () => [daysFromToday(0), daysFromToday(0)] },
  next7: { label: "Next 7 days", range: () => [daysFromToday(0), daysFromToday(7)] },
  next30: { label: "Next 30 days", range: () => [daysFromToday(0), daysFromToday(30)] },
  last30: { label: "Last 30 days", range: () => [daysFromToday(-30), daysFromToday(0)] },
  last90: { label: "Last 90 days", range: () => [daysFromToday(-90), daysFromToday(0)] },
  thisYear: { label: "This year", range: () => [`${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`] },
  lastYear: { label: "Last year", range: () => [`${new Date().getFullYear() - 1}-01-01`, `${new Date().getFullYear() - 1}-12-31`] }
};

// Whether a record's date (any string or Firestore timestamp starting with
// YYYY-MM-DD) passes a date filter. A record with no date only passes when
// the filter is off.
export function matchesDateFilter(date, filter) {
  if (!filter || !filter.preset) return true;
  const key = date?.seconds
    ? localKey(new Date(date.seconds * 1000))
    : (typeof date === "string" ? date.slice(0, 10) : "");
  if (!key) return false;

  let from = null;
  let to = null;
  if (filter.preset === "custom") {
    from = filter.from || null;
    to = filter.to || null;
  } else if (DATE_PRESETS[filter.preset]) {
    [from, to] = DATE_PRESETS[filter.preset].range();
  }
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

// Distinct, sorted, non-empty values -> select options.
export const optionsFrom = (values, labelFor = (v) => v) =>
  Array.from(new Set(values.filter(Boolean)))
    .sort((a, b) => String(labelFor(a)).localeCompare(String(labelFor(b))))
    .map(v => ({ value: v, label: labelFor(v) }));

export const isFilterActive = (value) =>
  typeof value === "object" && value !== null ? !!value.preset : !!value;

export default function FilterBar({ idPrefix, filters, values, onChange, onClear, resultCount, resultNoun = "results" }) {
  const activeCount = filters.filter(f => isFilterActive(values[f.key])).length;

  return (
    <div className="filter-bar">
      <div className="filter-bar-fields">
        {filters.map(f => {
          const id = `${idPrefix}-${f.key}`;

          if (f.type === "date") {
            const v = values[f.key] || { preset: "", from: "", to: "" };
            return (
              <div key={f.key} className={`filter-field ${v.preset === "custom" ? "filter-field-wide" : ""}`}>
                <label className="filter-label" htmlFor={id}>{f.label}</label>
                <select
                  id={id}
                  className={`field filter-control ${v.preset ? "is-active" : ""}`}
                  value={v.preset}
                  onChange={e => onChange(f.key, { ...v, preset: e.target.value })}
                >
                  <option value="">Any date</option>
                  {f.presets.map(p => <option key={p} value={p}>{DATE_PRESETS[p].label}</option>)}
                  <option value="custom">Custom range…</option>
                </select>
                {v.preset === "custom" && (
                  <div className="filter-range">
                    <input
                      id={`${id}-from`}
                      aria-label={`${f.label} from`}
                      type="date"
                      className="field filter-control"
                      value={v.from}
                      onChange={e => onChange(f.key, { ...v, from: e.target.value })}
                    />
                    <span>to</span>
                    <input
                      id={`${id}-to`}
                      aria-label={`${f.label} to`}
                      type="date"
                      className="field filter-control"
                      value={v.to}
                      onChange={e => onChange(f.key, { ...v, to: e.target.value })}
                    />
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={f.key} className="filter-field">
              <label className="filter-label" htmlFor={id}>{f.label}</label>
              <select
                id={id}
                className={`field filter-control ${values[f.key] ? "is-active" : ""}`}
                value={values[f.key] || ""}
                onChange={e => onChange(f.key, e.target.value)}
              >
                <option value="">{f.anyLabel || "Any"}</option>
                {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          );
        })}
      </div>

      <div className="filter-bar-summary">
        <span>
          <strong>{resultCount}</strong> {resultNoun}
          {activeCount > 0 && ` · ${activeCount} filter${activeCount === 1 ? "" : "s"} on`}
        </span>
        {activeCount > 0 && (
          <button type="button" className="settings-link" onClick={onClear}>Clear filters</button>
        )}
      </div>
    </div>
  );
}
