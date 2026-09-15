"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../../../lib/firebase";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { BUILDING_SECTORS } from "../../../lib/directory";
import { canViewAnalytics, summarize, breakdown, outcomesByMonth, formatMoney } from "../../../lib/analytics";
import DashboardHeader from "../../components/DashboardHeader";
import FilterBar, { matchesDateFilter, optionsFrom, isFilterActive } from "../../components/FilterBar";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const clearSession = () => localStorage.removeItem("loginTimestamp");

// Won / Lost / Did Not Bid are identities, not good/bad status, so they take
// the first three categorical slots (validated as a set on this surface).
const SERIES = [
  { key: "won", label: "Won", color: "#2a78d6" },
  { key: "lost", label: "Lost", color: "#eb6834" },
  { key: "dnb", label: "Did Not Bid", color: "#1baf7a" }
];

const pct = (n) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);

function StatTile({ label, value, sub }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-label">{label}</div>
      <div className="stat-tile-value">{value}</div>
      {sub && <div className="stat-tile-sub">{sub}</div>}
    </div>
  );
}

function OutcomesChart({ buckets }) {
  const [hover, setHover] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const max = Math.max(1, ...buckets.map(b => b.won + b.lost + b.dnb));
  const niceMax = Math.max(4, Math.ceil(max / 4) * 4);
  const ticks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax];
  const total = buckets.reduce((sum, b) => sum + b.won + b.lost + b.dnb, 0);

  return (
    <div className="analytics-card">
      <div className="analytics-card-head">
        <div>
          <h3 className="analytics-card-title">Outcomes by month</h3>
          <p className="analytics-card-sub">Pipeline entries resolved in each of the last 12 months</p>
        </div>
        <div className="chart-legend" aria-label="Legend">
          {SERIES.map(s => (
            <span key={s.key} className="chart-legend-item">
              <span className="chart-legend-swatch" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <p className="private-note-hint">Nothing was resolved in the last 12 months for these filters.</p>
      ) : (
        <div className="bar-chart" role="img" aria-label={`Won, lost, and did-not-bid counts for each of the last 12 months, ${total} total`}>
          <div className="bar-chart-axis">
            {[...ticks].reverse().map(t => <span key={t}>{t}</span>)}
          </div>
          <div className="bar-chart-plot">
            <div className="bar-chart-grid" aria-hidden="true">
              {ticks.map(t => (
                <div key={t} className="bar-chart-gridline" style={{ bottom: `${(t / niceMax) * 100}%` }} />
              ))}
            </div>
            <div className="bar-chart-columns">
              {buckets.map((b, i) => {
                const count = b.won + b.lost + b.dnb;
                return (
                  <div
                    key={b.key}
                    className="bar-chart-column"
                    tabIndex={0}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                  >
                    <div className="bar-chart-bar-area">
                      <div className="bar-chart-stack" style={{ height: `${(count / niceMax) * 100}%` }}>
                        {/* Stacked bottom-up: Won, Lost, Did Not Bid */}
                        {SERIES.map(s => b[s.key] > 0 && (
                          <div key={s.key} className="bar-chart-segment" style={{ flexGrow: b[s.key], background: s.color }} />
                        )).reverse()}
                      </div>
                    </div>
                    <div className={`bar-chart-label ${i === buckets.length - 1 || b.label === "Jan" ? "is-strong" : ""}`}>
                      {b.label}{b.label === "Jan" ? ` ’${String(b.year).slice(2)}` : ""}
                    </div>

                    {hover === i && (
                      <div className={`chart-tooltip ${i > buckets.length - 4 ? "is-left" : ""}`}>
                        <div className="chart-tooltip-title">
                          {new Date(b.year, Number(b.key.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                        </div>
                        {SERIES.map(s => (
                          <div key={s.key} className="chart-tooltip-row">
                            <span className="chart-tooltip-key" style={{ background: s.color }} />
                            <strong>{b[s.key]}</strong>
                            <span>{s.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <button type="button" className="settings-link" style={{ marginTop: 12 }} onClick={() => setShowTable(v => !v)}>
        {showTable ? "Hide table" : "Show as table"}
      </button>
      {showTable && (
        <div className="analytics-table-wrap" style={{ marginTop: 8 }}>
          <table className="analytics-table">
            <thead>
              <tr><th>Month</th><th>Won</th><th>Lost</th><th>Did Not Bid</th></tr>
            </thead>
            <tbody>
              {buckets.map(b => (
                <tr key={b.key}>
                  <td>{new Date(b.year, Number(b.key.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</td>
                  <td>{b.won}</td><td>{b.lost}</td><td>{b.dnb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BreakdownTable({ title, sub, rows }) {
  return (
    <div className="analytics-card">
      <h3 className="analytics-card-title">{title}</h3>
      {sub && <p className="analytics-card-sub">{sub}</p>}
      {rows.length === 0 ? (
        <p className="private-note-hint">No entries match these filters.</p>
      ) : (
        <div className="analytics-table-wrap">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>{title.replace("By ", "")}</th>
                <th>Entries</th>
                <th>Won</th>
                <th>Lost</th>
                <th>Did Not Bid</th>
                <th>Open</th>
                <th>Win rate</th>
                <th>Won volume</th>
                <th>Total volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <td className="analytics-table-name">{r.label || r.key}</td>
                  <td>{r.total}</td>
                  <td>{r.won}</td>
                  <td>{r.lost}</td>
                  <td>{r.dnb}</td>
                  <td>{r.open}</td>
                  <td>
                    <div className="win-rate-cell">
                      <span>{pct(r.winRate)}</span>
                      {r.winRate !== null && (
                        <span className="win-rate-track" aria-hidden="true">
                          <span className="win-rate-fill" style={{ width: `${r.winRate * 100}%` }} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td>{formatMoney(r.volume.won)}</td>
                  <td>{formatMoney(r.volume.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [uid, setUid] = useState(null);
  const [allowed, setAllowed] = useState(null); // null = checking
  const [loadError, setLoadError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({});

  useEffect(() => {
    let timer;
    const unsub = onAuthStateChanged(auth, async (user) => {
      const loginTimestamp = Number(localStorage.getItem("loginTimestamp") || 0);
      const elapsed = Date.now() - loginTimestamp;
      if (!user || !loginTimestamp || elapsed > SESSION_LENGTH_MS) {
        clearSession();
        signOut(auth);
        router.push("/");
        return;
      }
      timer = setTimeout(() => {
        clearSession();
        signOut(auth);
        router.push("/");
      }, SESSION_LENGTH_MS - elapsed);

      setUid(user.uid);
      try {
        const profileSnap = await getDoc(doc(db, "users", user.uid));
        if (!profileSnap.exists()) {
          router.push("/dashboard");
          return;
        }
        const profile = profileSnap.data();
        if (profile.disabled) {
          clearSession();
          await signOut(auth);
          router.push("/");
          return;
        }
        if (!canViewAnalytics(profile)) {
          setAllowed(false);
          return;
        }
        setAllowed(true);

        const [pipelineSnap, usersSnap] = await Promise.all([
          getDocs(collection(db, "pipeline")),
          getDocs(collection(db, "users"))
        ]);
        setEntries(pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoaded(true);
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading analytics.");
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const personLabel = (id) => {
    const u = users.find(x => x.id === id);
    if (!u) return "Unknown";
    return u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email;
  };
  // Credit goes to the assigned salesperson; entries without one fall back
  // to whoever created them.
  const salespersonOf = (e) => e.salespersonId || e.ownerId;

  const filtered = useMemo(() => entries
    .filter(e => !filters.sector || e.buildingSector === filters.sector)
    .filter(e => !filters.person || salespersonOf(e) === filters.person)
    .filter(e => !filters.stage || e.stage === filters.stage)
    .filter(e => matchesDateFilter(e.createdAt, filters.created)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [entries, filters]);

  const stats = useMemo(() => summarize(filtered), [filtered]);
  const months = useMemo(() => outcomesByMonth(filtered), [filtered]);
  const bySector = useMemo(() => breakdown(filtered, e => e.buildingSector), [filtered]);
  const byPerson = useMemo(
    () => breakdown(filtered, salespersonOf).map(r => ({ ...r, label: r.key === "Not set" ? "Not set" : personLabel(r.key) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, users]
  );

  const filterDefs = [
    { key: "created", label: "Entry created", type: "date", presets: ["last30", "last90", "thisYear", "lastYear"] },
    { key: "sector", label: "Sector", type: "select", options: BUILDING_SECTORS.map(v => ({ value: v, label: v })) },
    { key: "person", label: "Salesperson", type: "select", options: optionsFrom(entries.map(salespersonOf), personLabel) },
    { key: "stage", label: "Stage", type: "select", options: optionsFrom(entries.map(e => e.stage)) }
  ];

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load analytics</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (allowed === false) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">No access to Analytics</h3>
          <p className="modal-subtitle">Estimating Analytics is available to the Estimating Department and admins. Ask an admin to turn it on for your account.</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <div className="dashboard-page">Loading...</div>;
  }

  const anyFilter = Object.values(filters).some(isFilterActive);

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Estimating Analytics</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>← Back to Dashboard</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <FilterBar
        idPrefix="analytics-filter"
        filters={filterDefs}
        values={filters}
        onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({})}
        resultCount={filtered.length}
        resultNoun={filtered.length === 1 ? "pipeline entry" : "pipeline entries"}
      />

      <h2 className="analytics-section-title">Bids</h2>
      <div className="stat-row">
        <StatTile label="Total entries" value={stats.total} sub={anyFilter ? "Matching filters" : "All pipeline entries"} />
        <StatTile label="Bid on" value={stats.bidOn} sub="Everything except Did Not Bid" />
        <StatTile label="Won" value={stats.won} />
        <StatTile label="Lost" value={stats.lost} />
        <StatTile label="Did Not Bid" value={stats.dnb} />
        <StatTile label="Still open" value={stats.open} />
        <StatTile label="Win rate" value={pct(stats.winRate)} sub={stats.decided ? `${stats.won} of ${stats.decided} decided bids` : "No decided bids yet"} />
      </div>

      <h2 className="analytics-section-title">Volume</h2>
      <div className="stat-row">
        <StatTile label="Total bid volume" value={formatMoney(stats.volume.total)} />
        <StatTile label="Won volume" value={formatMoney(stats.volume.won)} />
        <StatTile label="Lost volume" value={formatMoney(stats.volume.lost)} />
        <StatTile label="Open volume" value={formatMoney(stats.volume.open)} sub="Still in the pipeline" />
        <StatTile label="Avg. won job" value={stats.avgWonValue ? formatMoney(stats.avgWonValue) : "—"} />
      </div>
      {stats.missingValue > 0 && (
        <p className="private-note-hint" style={{ marginTop: -4 }}>
          {stats.missingValue} of {stats.total} entries have no usable estimated value (blank or not a number), so they aren't counted in volume.
        </p>
      )}

      <OutcomesChart buckets={months} />

      <BreakdownTable title="By sector" sub="Entries missing a sector show as Not set." rows={bySector} />
      <BreakdownTable title="By salesperson" sub="Credited to the assigned salesperson, or whoever created the entry if none was assigned." rows={byPerson} />
    </div>
  );
}
