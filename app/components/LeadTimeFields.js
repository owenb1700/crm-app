"use client";

import { leadTimeStatus, describeLeadTime, parseLeadTime, todayKey, TRANSIT_DAYS } from "../../lib/leadTimes";

// The lead time on a project or pipeline entry, and the three dates that
// move it along. Shared by both so they can't drift.
//
// One lead time for the whole job, not one per piece of equipment:
// everything on a job ships together almost every time, so the number to
// put here is the LONGEST item's -- the job is only as early as the piece
// that lands last.

export function LeadTimeFields({ idPrefix, values, setValues }) {
  const set = (field) => (e) => setValues(prev => ({ ...prev, [field]: e.target.value }));
  const stamp = (field) => () => setValues(prev => ({ ...prev, [field]: todayKey() }));

  const parsed = parseLeadTime(values.leadTime, { defaultUnit: "weeks" });
  const status = leadTimeStatus(values, todayKey(), { defaultUnit: "weeks" });

  const hint = !String(values.leadTime || "").trim()
    ? "The longest item's lead time — everything ships together."
    : parsed
      ? `Read as ${parsed.label}${parsed.isRange ? ` — estimates use the middle, ${parsed.days} days` : ""}.`
      : "Not a lead time yet — try \"14-16 weeks\" or \"30 days\".";

  return (
    <>
      <div className="form-grid-2">
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-lead-time`}>Lead time</label>
          <input
            id={`${idPrefix}-lead-time`}
            className="field"
            placeholder="e.g. 14-16 weeks"
            value={values.leadTime || ""}
            onChange={set("leadTime")}
          />
          <p className="private-note-hint" style={{ marginTop: -4 }}>{hint}</p>
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-ordered-on`}>Ordered on</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input id={`${idPrefix}-ordered-on`} className="field" type="date" style={{ marginBottom: 0 }} value={values.orderedOn || ""} onChange={set("orderedOn")} />
            <button type="button" className="btn btn-secondary btn-small" onClick={stamp("orderedOn")}>Today</button>
          </div>
          <p className="private-note-hint" style={{ marginTop: 4 }}>Starts the clock on the lead time.</p>
        </div>
      </div>

      <div className="form-grid-2">
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-shipped-on`}>Shipped on</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input id={`${idPrefix}-shipped-on`} className="field" type="date" style={{ marginBottom: 0 }} value={values.shippedOn || ""} onChange={set("shippedOn")} />
            <button type="button" className="btn btn-secondary btn-small" onClick={stamp("shippedOn")}>Today</button>
          </div>
          <p className="private-note-hint" style={{ marginTop: 4 }}>Freight is figured at {TRANSIT_DAYS} days from here.</p>
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

      {status.state !== "none" && (
        <p className="private-note-hint" style={{ marginTop: 2 }}>{describeLeadTime(status, { subject: "This job" })}</p>
      )}
    </>
  );
}

// The read-only line on a record's page and on list cards.
export function LeadTimeSummary({ record, subject = "This job", defaultUnit = "weeks", className = "customer-meta" }) {
  const status = leadTimeStatus(record, todayKey(), { defaultUnit });
  if (status.state === "none") return null;

  const late = status.state === "ship-late" || status.state === "delivery-due";
  const due = status.state === "ship-due";

  return (
    <div className={className} style={late ? { color: "#dc2626" } : due ? { color: "#b45309" } : undefined}>
      {late || due ? "⚠ " : ""}{describeLeadTime(status, { subject })}
    </div>
  );
}
