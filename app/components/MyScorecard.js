"use client";

import { useState } from "react";
import { summarize, formatMoney } from "../../lib/analytics";

const pct = (n) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);

// A person's own pipeline numbers at the top of My Dashboard. Entries are
// credited the same way as the Analytics page: the assigned salesperson,
// or whoever created the entry if none was assigned. Only ever shows the
// signed-in user's own numbers.
export default function MyScorecard({ pipelineEntries, uid }) {
  const [range, setRange] = useState("year"); // "year" | "all"

  const mine = pipelineEntries.filter(e => (e.salespersonId || e.ownerId) === uid);
  if (mine.length === 0) return null;

  const yearStart = `${new Date().getFullYear()}-01-01`;
  const inRange = range === "year" ? mine.filter(e => String(e.createdAt || "") >= yearStart) : mine;
  const s = summarize(inRange);

  const tiles = [
    { label: "Bid on", value: s.bidOn },
    { label: "Won", value: s.won },
    { label: "Lost", value: s.lost },
    { label: "Win rate", value: pct(s.winRate) },
    { label: "Won volume", value: formatMoney(s.volume.won) },
    { label: "Open volume", value: formatMoney(s.volume.open) }
  ];

  return (
    <div className="scorecard">
      <div className="scorecard-head">
        <h3 className="analytics-card-title">My Scorecard</h3>
        <div className="scorecard-toggle" role="group" aria-label="Time range">
          <button type="button" className={range === "year" ? "is-active" : ""} aria-pressed={range === "year"} onClick={() => setRange("year")}>
            This year
          </button>
          <button type="button" className={range === "all" ? "is-active" : ""} aria-pressed={range === "all"} onClick={() => setRange("all")}>
            All time
          </button>
        </div>
      </div>
      <div className="scorecard-tiles">
        {tiles.map(t => (
          <div key={t.label} className="scorecard-tile">
            <div className="stat-tile-label">{t.label}</div>
            <div className="scorecard-value">{t.value}</div>
          </div>
        ))}
      </div>
      <p className="private-note-hint" style={{ margin: "8px 0 0" }}>
        Pipeline entries where you're the salesperson (or you created them with no salesperson assigned). Win rate counts only won and lost bids.
      </p>
    </div>
  );
}
