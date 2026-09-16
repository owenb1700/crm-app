"use client";

// Filters for a whole list page (Team, Pipeline, Past Projects). Each
// filter is either a "select" ({ key, label, options: [{ value, label }] })
// or a "date" range ({ key, label, presets: [...keys of DATE_PRESETS] }).
// Values live in the page: { [key]: string } for selects ("" = any) and
// { [key]: { preset, from, to } } for dates.

import { DATE_PRESETS, matchesDateFilter } from "../../lib/dateFilter";

export { DATE_PRESETS, matchesDateFilter };

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
