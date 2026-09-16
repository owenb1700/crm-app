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

  const records = metric.records({
    entries: filterEntries(entries, filters),
    projects: filterProjects(projects, filters)
  });
  const isPipeline = metric.kind === "pipeline";
  const value = (r) => parseMoney(isPipeline ? r.value : r.projectValue);
  const totalValue = records.reduce((sum, r) => sum + (value(r) || 0), 0);
  const missingValue = records.filter(r => value(r) === null).length;

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
    headers: isPipeline
      ? ["Opportunity", "Status", "Stage", "Salesperson", "Engineering firm", "Sector", "Work type", "Bid date", "Value (as entered)", "Value ($)", "Created"]
      : ["Project", "Status", "Salesperson", "Contractor / owner", "Sector", "Work type", "Next check-in", "Value (as entered)", "Value ($)", "Created"],
    rows: records.map(r => (isPipeline
      ? [r.title, STATUS_LABEL[statusOf(r)], r.stage, personLabel(salespersonOfEntry(r)), r.company, r.buildingSector, r.workType, day(r.bidDate), r.value, value(r) ?? "", day(r.createdAt)]
      : [r.projectName || r.company, r.category, personLabel(salespersonOfProject(r)), r.company, r.buildingSector, r.workType, day(r.nextCheckIn), r.projectValue, value(r) ?? "", day(r.createdAt)]))
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
            <h3 className="analytics-card-title">
              {records.length} {isPipeline ? (records.length === 1 ? "pipeline entry" : "pipeline entries") : (records.length === 1 ? "project" : "projects")} · {formatMoney(totalValue)}
            </h3>
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
                {isPipeline ? (
                  <tr><th>Opportunity</th><th>Status</th><th>Stage</th><th>Salesperson</th><th>Engineering firm</th><th>Work type</th><th>Bid date</th><th>Value</th></tr>
                ) : (
                  <tr><th>Project</th><th>Status</th><th>Salesperson</th><th>Contractor / owner</th><th>Work type</th><th>Next check-in</th><th>Value</th></tr>
                )}
              </thead>
              <tbody>
                {records.map(r => (
                  <tr
                    key={r.id}
                    className="analytics-row-link"
                    onClick={() => router.push(isPipeline ? `/dashboard/pipeline/${r.id}` : `/dashboard/project/${r.id}`)}
                  >
                    <td className="analytics-table-name" data-label={isPipeline ? "Opportunity" : "Project"}>{isPipeline ? r.title : (r.projectName || r.company)}</td>
                    <td data-label="Status">{isPipeline ? STATUS_LABEL[statusOf(r)] : (r.category || "—")}</td>
                    {isPipeline && <td data-label="Stage">{r.stage || "—"}</td>}
                    <td data-label="Salesperson">{personLabel(isPipeline ? salespersonOfEntry(r) : salespersonOfProject(r))}</td>
                    <td data-label={isPipeline ? "Engineering firm" : "Contractor / owner"}>{r.company || "—"}</td>
                    <td data-label="Work type">{r.workType || "—"}</td>
                    <td data-label={isPipeline ? "Bid date" : "Next check-in"}>{day(isPipeline ? r.bidDate : r.nextCheckIn) || "—"}</td>
                    <td data-label="Value">{value(r) === null ? "—" : formatMoney(value(r))}</td>
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
