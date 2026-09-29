"use client";

import { leadTimeStatus, describeLeadTime, parseLeadTime, todayKey, TRANSIT_DAYS, LEAD_TIME_UNITS, leadTimeParts, formatLeadTime } from "../../lib/leadTimes";

// The lead time on a project, pipeline entry or parts request, and the
// dates that move it along. Shared by all of them so they can't drift.
//
// One lead time for the whole job, not one per piece of equipment. A job
// usually has several components coming, each on its own lead time, and
// they ship together -- so the figure that matters is the LONGEST of
// them. The job is only as early as the component that lands last.
//
// Most lead times are recorded and never chased: the figure is there for
// the history, and nothing alerts anyone unless they ask for it.

// "[3] to [4] [Weeks v]". The second box is optional -- filling only the
// first is an exact figure rather than a range. Whatever the boxes say is
// stored as one string ("3-4 weeks"), which is also what a lead time
// typed before this was a dropdown looks like.
export function LeadTimeInput({ idPrefix, value, onChange, defaultUnit = "weeks" }) {
  const parts = leadTimeParts(value, { defaultUnit });
  const push = (next) => onChange(formatLeadTime({ ...parts, ...next }));
  const number = (v) => v.replace(/[^\d.]/g, "");

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input
        id={`${idPrefix}-lead-low`}
        className="field"
        style={{ marginBottom: 0, width: 72 }}
        inputMode="decimal"
        placeholder="—"
        aria-label="Lead time, from"
        value={parts.low}
        onChange={e => push({ low: number(e.target.value) })}
      />
      <span className="private-note-hint" style={{ margin: 0 }}>to</span>
      <input
        id={`${idPrefix}-lead-high`}
        className="field"
        style={{ marginBottom: 0, width: 72 }}
        inputMode="decimal"
        placeholder="—"
        aria-label="Lead time, to (leave blank if it's an exact figure)"
        value={parts.high}
        onChange={e => push({ high: number(e.target.value) })}
      />
      <select
        id={`${idPrefix}-lead-unit`}
        className="field"
        style={{ marginBottom: 0, width: 150 }}
        aria-label="Lead time unit"
        value={parts.unit}
        onChange={e => push({ unit: e.target.value })}
      >
        {LEAD_TIME_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
      </select>
    </div>
  );
}

// `allowAlerts` is whether there is yet anything to be alerted about.
// Entering a job, nobody knows when it will be ordered -- the lead time
// is a note, not a clock -- so the create forms pass false and only the
// figure is asked for. It turns true once the job reaches Order, which
// is when an order date exists to count from.
//
// Parts keep asking straight away: a part is quoted and ordered on the
// same screen, so `allowAlerts` defaults to true and only the callers
// that want it off say so.
export function LeadTimeFields({
  idPrefix,
  values,
  setValues,
  defaultUnit = "weeks",
  subject = "This job",
  allowAlerts = true
}) {
  const set = (field) => (e) => setValues(prev => ({ ...prev, [field]: e.target.value }));
  const stamp = (field) => () => setValues(prev => ({ ...prev, [field]: todayKey() }));

  // Parts are a single item; a job is several components on different
  // lead times, so on a job the figure wanted is the longest of them.
  const longestWord = defaultUnit === "days" ? "supplier's" : "longest component's";
  const hasLeadTime = !!String(values.leadTime || "").trim();
  const parsed = parseLeadTime(values.leadTime, { defaultUnit });
  const alertsOn = values.leadTimeAlerts === true;
  const status = leadTimeStatus(values, todayKey(), { defaultUnit });
  // Never hide a control that is already doing something: a record with
  // alerts on, or a date already recorded, keeps its section so it can
  // still be turned off or corrected.
  const showAlerts = allowAlerts || alertsOn || !!values.orderedOn;

  // Switching alerts on needs a day to count from, so it fills in today's
  // date -- right most of the time, and editable when it isn't.
  const toggleAlerts = (e) => {
    const on = e.target.checked;
    setValues(prev => ({
      ...prev,
      leadTimeAlerts: on,
      orderedOn: on && !prev.orderedOn ? todayKey() : prev.orderedOn
    }));
  };

  const hint = !hasLeadTime
    ? `The ${longestWord} lead time — a job usually has several components coming, and they ship together. Leave it blank if you're not tracking one.`
    : parsed
      ? `${parsed.isRange ? "Middle of the range \u2014 " : ""}${parsed.days} business days${parsed.inWeeks ? " (5 per week)" : ""}.`
      : "Second number has to be at least the first.";

  return (
    <>
      <div className="form-grid-2">
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-lead-low`}>
            Lead time{defaultUnit === "days" ? "" : " (longest component)"}
          </label>
          <LeadTimeInput
            idPrefix={idPrefix}
            value={values.leadTime || ""}
            onChange={v => setValues(prev => ({ ...prev, leadTime: v }))}
            defaultUnit={defaultUnit}
          />
          <p className="private-note-hint" style={{ marginTop: 4 }}>{hint}</p>
        </div>

        {showAlerts && (
        <div>
          <span className="field-label">Alerts</span>
          <label className="export-notes-toggle" htmlFor={`${idPrefix}-lead-alerts`} style={{ marginBottom: 0 }}>
            <input
              id={`${idPrefix}-lead-alerts`}
              type="checkbox"
              checked={alertsOn}
              disabled={!hasLeadTime}
              onChange={toggleAlerts}
            />
            <span>
              <strong>Tell me if it slips</strong>
              <span className="export-row-desc">
                {hasLeadTime
                  ? "On the ship date, when it ships, and again if it hasn't landed two business days later."
                  : "Give it a lead time first."}
              </span>
            </span>
          </label>
        </div>
        )}
      </div>

      {/* Once it has been ordered the dates stand on their own: when it
          was ordered is worth recording, and the ship date is worked out
          from it, whether or not anybody asked to be told about it.
          Ticking alerts decides who gets nudged, not what gets kept. */}
      {showAlerts && hasLeadTime && (
        <div className="form-grid-3">
          <div>
            <label className="field-label" htmlFor={`${idPrefix}-ordered-on`}>Order date</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input id={`${idPrefix}-ordered-on`} className="field" type="date" style={{ marginBottom: 0 }} value={values.orderedOn || ""} onChange={set("orderedOn")} />
              <button type="button" className="btn btn-secondary btn-small" onClick={stamp("orderedOn")}>Today</button>
            </div>
            <p className="private-note-hint" style={{ marginTop: 4 }}>The lead time is counted from here.</p>
          </div>
          <div>
            <label className="field-label" htmlFor={`${idPrefix}-shipped-on`}>Shipped on</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input id={`${idPrefix}-shipped-on`} className="field" type="date" style={{ marginBottom: 0 }} value={values.shippedOn || ""} onChange={set("shippedOn")} />
              <button type="button" className="btn btn-secondary btn-small" onClick={stamp("shippedOn")}>Today</button>
            </div>
            <p className="private-note-hint" style={{ marginTop: 4 }}>Freight is figured at {TRANSIT_DAYS} business days.</p>
          </div>
          <div>
            <label className="field-label" htmlFor={`${idPrefix}-delivered-on`}>Delivered on</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input id={`${idPrefix}-delivered-on`} className="field" type="date" style={{ marginBottom: 0 }} value={values.deliveredOn || ""} onChange={set("deliveredOn")} />
              <button type="button" className="btn btn-secondary btn-small" onClick={stamp("deliveredOn")}>Today</button>
            </div>
            <p className="private-note-hint" style={{ marginTop: 4 }}>Filling this in stops the alerts.</p>
          </div>
        </div>
      )}

      {status.state !== "none" && (
        <p className="private-note-hint" style={{ marginTop: 2 }}>{describeLeadTime(status, { subject })}</p>
      )}
    </>
  );
}

// The read-only line on a record's page and on list cards. A lead time
// nobody asked to be alerted about still shows what it works out to --
// it just never turns red, because nothing is being chased.
export function LeadTimeSummary({ record, subject = "This job", defaultUnit = "weeks", className = "customer-meta" }) {
  const status = leadTimeStatus(record, todayKey(), { defaultUnit });
  if (status.state === "none") return null;

  const alertsOn = record?.leadTimeAlerts === true;
  const late = alertsOn && (status.state === "ship-late" || status.state === "delivery-due");
  const due = alertsOn && status.state === "ship-due";

  // A span, not a div: this sits inside a <p> on the pipeline header, and
  // a div in a paragraph is invalid HTML -- the browser moves it and
  // hydration then mismatches. display:block keeps it on its own line
  // everywhere it's used.
  return (
    <span
      className={className}
      style={{
        display: "block",
        ...(late ? { color: "var(--color-danger)" } : due ? { color: "var(--color-warning-strong)" } : {})
      }}
    >
      {late || due ? "\u26a0 " : ""}{describeLeadTime(status, { subject })}
    </span>
  );
}
