"use client";

import { useState } from "react";
import {
  rebuildDays, withSameMen, laborDays, totalManDays, peakMen,
  dayLoad, describeDayLoad, MAX_DAYS
} from "../../lib/laborSchedule";

// When the work happens and how many men are on it each day.
//
// The same editor on the project's own page and in the scheduling
// calendar's popup, so the two can never drift -- and both write to the
// project itself, which is the only copy there is.
//
// A day that would put the company over its usual crew says so, per day,
// but never blocks the save: jobs get booked over capacity all the time
// and then sorted out. The warning is there so it's a decision.
export default function LaborScheduleEditor({ value, onChange, byDate, projectId, idPrefix = "labor" }) {
  const days = laborDays({ laborSchedule: value });
  const includeWeekends = value?.includeWeekends === true;

  // Start and length drive the rows; the rows themselves hold the men.
  const [sameMen, setSameMen] = useState("");
  const start = days[0]?.date || "";
  const count = days.length;

  const push = (next) => onChange({ includeWeekends, days, ...next });

  const rebuild = ({ newStart = start, newCount = count, weekends = includeWeekends }) => {
    push({
      includeWeekends: weekends,
      days: rebuildDays({
        start: newStart,
        count: newCount,
        includeWeekends: weekends,
        existing: days,
        defaultMen: Number(sameMen) || 0
      })
    });
  };

  const setMenOn = (date, men) =>
    push({ days: days.map(d => (d.date === date ? { ...d, men: Math.max(0, Math.round(Number(men) || 0)) } : d)) });

  const applyToAll = () => push({ days: withSameMen(days, sameMen) });

  return (
    <div>
      <div className="form-grid-3">
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-start`}>Work starts</label>
          <input
            id={`${idPrefix}-start`}
            className="field"
            type="date"
            value={start}
            onChange={e => rebuild({ newStart: e.target.value, newCount: count || 1 })}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-count`}>How many days</label>
          <input
            id={`${idPrefix}-count`}
            className="field"
            inputMode="numeric"
            value={count || ""}
            placeholder="—"
            onChange={e => {
              const n = Math.min(MAX_DAYS, Number(e.target.value.replace(/[^\d]/g, "")) || 0);
              rebuild({ newCount: n });
            }}
          />
        </div>
        <div>
          <span className="field-label">Weekends</span>
          <label className="export-notes-toggle" htmlFor={`${idPrefix}-weekends`} style={{ marginBottom: 0 }}>
            <input
              id={`${idPrefix}-weekends`}
              type="checkbox"
              checked={includeWeekends}
              onChange={e => rebuild({ weekends: e.target.checked })}
            />
            <span>
              <strong>Crew works weekends</strong>
              <span className="export-row-desc">Off, the days run Monday to Friday.</span>
            </span>
          </label>
        </div>
      </div>

      {!start ? (
        <p className="private-note-hint">Pick a start date and how many days, then set the men on each one.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
            <label className="field-label" htmlFor={`${idPrefix}-same`} style={{ margin: 0 }}>Same every day</label>
            <input
              id={`${idPrefix}-same`}
              className="field"
              style={{ marginBottom: 0, width: 80 }}
              inputMode="numeric"
              placeholder="men"
              value={sameMen}
              onChange={e => setSameMen(e.target.value.replace(/[^\d]/g, ""))}
            />
            <button type="button" className="btn btn-secondary btn-small" disabled={!sameMen} onClick={applyToAll}>
              Apply to all {days.length} days
            </button>
            <span className="private-note-hint" style={{ margin: 0 }}>or set each day below</span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {days.map(d => {
                const load = byDate ? dayLoad(byDate, d.date, { excludeProjectId: projectId, adding: d.men }) : null;
                return (
                  <tr key={d.date}>
                    <td style={{ padding: "6px 8px 6px 0", whiteSpace: "nowrap", verticalAlign: "top" }}>
                      <strong>{d.date}</strong>
                    </td>
                    <td style={{ padding: "6px 8px", width: 90, verticalAlign: "top" }}>
                      <input
                        className="field"
                        style={{ marginBottom: 0, width: 72 }}
                        inputMode="numeric"
                        aria-label={`Men on ${d.date}`}
                        value={d.men || ""}
                        placeholder="0"
                        onChange={e => setMenOn(d.date, e.target.value.replace(/[^\d]/g, ""))}
                      />
                    </td>
                    <td style={{ padding: "6px 0", verticalAlign: "top" }}>
                      {load && (
                        <span className="private-note-hint" style={load.over ? { color: "#b45309" } : undefined}>
                          {load.over ? "⚠ " : ""}{describeDayLoad(load)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {days.length > 0 && (
            <p className="private-note-hint" style={{ marginTop: 8 }}>
              {days.length} {days.length === 1 ? "day" : "days"} · {totalManDays({ laborSchedule: value })} man-days · {peakMen({ laborSchedule: value })} at peak.
              {" "}Days with nobody on them aren&apos;t saved.
            </p>
          )}
        </>
      )}
    </div>
  );
}
