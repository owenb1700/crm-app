"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { auth, db } from "../../../../lib/firebase";
import { canViewAnalytics, formatMoney, parseMoney, statusOf } from "../../../../lib/analytics";
import { METRICS, decodeFilters, filterEntries, filterProjects, salespersonOfEntry, salespersonOfProject } from "../../../../lib/analyticsFilters";
import { downloadTable, csvDateStamp } from "../../../../lib/csv";
import { withoutTrashed } from "../../../../lib/trash";
import ExportButtons from "../../../components/ExportButtons";
import DashboardHeader from "../../../components/DashboardHeader";
import MobileNav from "../../../components/MobileNav";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const STATUS_LABEL = { won: "Won", lost: "Lost", dnb: "Did Not Bid", open: "Open" };
const day = (v) => String(v || "").slice(0, 10);

// The records behind one number on the Analytics page: open a tile there and
// this lists exactly what it counted, with the same filters still applied.
function AnalyticsDetailsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const metricKey = searchParams.get("metric") || "total";
  const filters = decodeFilters(searchParams.get("f"));
  const metric = METRICS[metricKey] || METRICS.total;

  const [uid, setUid] = useState(null);
  const [allowed, setAllowed] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [entries, setEntries] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let timer;
    const unsub = onAuthStateChanged(auth, async (user) => {
      const loginTimestamp = Number(localStorage.getItem("loginTimestamp") || 0);
      const elapsed = Date.now() - loginTimestamp;
      if (!user || !loginTimestamp || elapsed > SESSION_LENGTH_MS) {
        localStorage.removeItem("loginTimestamp");
        signOut(auth);
        router.push("/");
        return;
      }
      timer = setTimeout(() => {
        localStorage.removeItem("loginTimestamp");
        signOut(auth);
        router.push("/");
      }, SESSION_LENGTH_MS - elapsed);
      setUid(user.uid);

      try {
        const profileSnap = await getDoc(doc(db, "users", user.uid));
        const profile = profileSnap.exists() ? profileSnap.data() : null;
        if (!profile || profile.disabled || !canViewAnalytics(profile)) {
          setAllowed(false);
          return;
        }
        setAllowed(true);
        const [pipelineSnap, customersSnap, usersSnap] = await Promise.all([
          getDocs(collection(db, "pipeline")),
          getDocs(collection(db, "customers")),
          getDocs(collection(db, "users"))
        ]);
        setEntries(withoutTrashed(pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
        setProjects(withoutTrashed(customersSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
        setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoaded(true);
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading these records.");
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

  const backToAnalytics = () => {
    const f = searchParams.get("f");
    router.push(`/dashboard/analytics${f ? `?f=${f}` : ""}`);
  };

  if (allowed === false) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">No access to Analytics</h3>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>Back to My Projects</button>
        </div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn&apos;t load these records</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={backToAnalytics}>Back to Analytics</button>
        </div>
      </div>
    );
  }
  if (!loaded) return <div className="dashboard-page">Loading...</div>;

  // A tile can hold pipeline entries, projects, or both; each record carries
  // which it is so one table can list them together.
  const picked = metric.records({
    entries: filterEntries(entries, filters),
    projects: filterProjects(projects, filters)
  });
  const records = [
    ...picked.entries.map(e => ({
      kind: "Pipeline",
      id: e.id,
      href: `/dashboard/pipeline/${e.id}`,
      name: e.title || "Untitled pipeline entry",
      status: STATUS_LABEL[statusOf(e)],
      stage: e.stage || "",
      person: salespersonOfEntry(e),
      company: e.company,
      sector: e.buildingSector,
      workType: e.workType,
      date: day(e.bidDate),
      rawValue: e.value,
      value: parseMoney(e.value),
      created: day(e.createdAt)
    })),
    ...picked.projects.map(p => ({
      kind: "Project",
      id: p.id,
      href: `/dashboard/project/${p.id}`,
      name: p.projectName || p.company || "Untitled project",
      status: p.category || "",
      stage: "",
      person: salespersonOfProject(p),
      company: p.company,
      sector: p.buildingSector,
      workType: p.workType,
      date: day(p.nextCheckIn),
      rawValue: p.projectValue,
      value: parseMoney(p.projectValue),
      created: day(p.createdAt)
    }))
  ].sort((a, b) => (b.value || 0) - (a.value || 0) || a.name.localeCompare(b.name));

  const hasProjects = picked.projects.length > 0;
  const hasEntries = picked.entries.length > 0;
  const countLabel = hasEntries && hasProjects
    ? `${picked.entries.length} pipeline ${picked.entries.length === 1 ? "entry" : "entries"} + ${picked.projects.length} project${picked.projects.length === 1 ? "" : "s"}`
    : hasProjects
      ? `${picked.projects.length} project${picked.projects.length === 1 ? "" : "s"}`
      : `${picked.entries.length} pipeline ${picked.entries.length === 1 ? "entry" : "entries"}`;
  const totalValue = records.reduce((sum, r) => sum + (r.value || 0), 0);
  const missingValue = records.filter(r => r.value === null).length;

  const activeFilters = Object.entries(filters)
    .map(([key, v]) => {
      if (typeof v === "object" && v !== null) return v.preset ? `${key}: ${v.preset === "custom" ? `${v.from || "…"} to ${v.to || "…"}` : v.preset}` : null;
      if (!v) return null;
      return key === "person" ? `salesperson: ${personLabel(v)}` : `${key}: ${v}`;
    })
    .filter(Boolean);

  const exportRecords = (format) => downloadTable({
    format,
    filename: `${metricKey}-${csvDateStamp()}`,
    sheetName: metric.label.slice(0, 28),
    headers: ["Type", "Name", "Status", "Stage", "Salesperson", "Firm", "Sector", "Work type", "Bid date / next check-in", "Value (as entered)", "Value ($)", "Created"],
    rows: records.map(r => [
      r.kind, r.name, r.status, r.stage, personLabel(r.person), r.company, r.sector, r.workType, r.date, r.rawValue, r.value ?? "", r.created
    ])
  });

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">{metric.label}</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={backToAnalytics}>← Back to Analytics</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="analytics-card">
        <div className="analytics-card-head" style={{ marginBottom: 0 }}>
          <div>
            <h3 className="analytics-card-title">{countLabel} · {formatMoney(totalValue)}</h3>
            <p className="analytics-card-sub">
              {metric.sub ? `${metric.sub}. ` : ""}
              {activeFilters.length ? `Filters: ${activeFilters.join(", ")}.` : "No filters applied."}
              {missingValue > 0 ? ` ${missingValue} with no usable value.` : ""}
            </p>
          </div>
          {records.length > 0 && <ExportButtons label="these records" buttonText="Export these records" onExport={exportRecords} />}
        </div>

        {records.length === 0 ? (
          <p className="private-note-hint">Nothing to show here.</p>
        ) : (
          <div className="analytics-table-wrap">
            <table className="analytics-table stack-on-phone">
              <thead>
                <tr>
                  <th>Type</th><th>Name</th><th>Status</th><th>Salesperson</th><th>Firm</th><th>Work type</th><th>Bid / check-in</th><th>Value</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={`${r.kind}-${r.id}`} className="analytics-row-link" onClick={() => router.push(r.href)}>
                    <td data-label="Type">{r.kind}</td>
                    <td className="analytics-table-name" data-label="Name">{r.name}</td>
                    <td data-label="Status">{r.status || "—"}</td>
                    <td data-label="Salesperson">{personLabel(r.person)}</td>
                    <td data-label="Firm">{r.company || "—"}</td>
                    <td data-label="Work type">{r.workType || "—"}</td>
                    <td data-label="Bid / check-in">{r.date || "—"}</td>
                    <td data-label="Value">{r.value === null ? "—" : formatMoney(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AnalyticsDetailsPage() {
  return (
    <Suspense fallback={<div className="dashboard-page">Loading...</div>}>
      <AnalyticsDetailsContent />
    </Suspense>
  );
}
