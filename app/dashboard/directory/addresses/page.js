"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { auth, db } from "../../../../lib/firebase";
import { withoutTrashed } from "../../../../lib/trash";
import {
  collectAddresses, addressKey, groupSimilarAddresses, addressFacets, filterBuildings
} from "../../../../lib/addresses";
import { SECTOR_COLLECTION, applyBuildingSectors } from "../../../../lib/buildingSectors";
import { downloadTable, csvDateStamp } from "../../../../lib/csv";
import DashboardHeader from "../../../components/DashboardHeader";
import MobileNav from "../../../components/MobileNav";
import ExportButtons from "../../../components/ExportButtons";
import SortPicker from "../../../components/SortPicker";
import { sortRows } from "../../../../lib/sorting";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const clearSession = () => localStorage.removeItem("loginTimestamp");

// Every building we've worked on, gathered from the addresses on projects,
// pipeline entries and parts orders. Nothing is entered here -- the list
// builds itself from the work.
function AddressesPageContent() {
  const router = useRouter();

  const [uid, setUid] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [projects, setProjects] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [parts, setParts] = useState([]);
  const [sectorRecords, setSectorRecords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("");
  const [firm, setFirm] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState({ key: "address", direction: "asc" });

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
        if (!profileSnap.exists() || profileSnap.data().disabled) {
          clearSession();
          await signOut(auth);
          router.push("/");
          return;
        }
        setMyProfile(profileSnap.data());

        const [projectsSnap, pipelineSnap, partsSnap, sectorsSnap] = await Promise.all([
          getDocs(collection(db, "customers")),
          getDocs(collection(db, "pipeline")),
          getDocs(collection(db, "parts")),
          getDocs(collection(db, SECTOR_COLLECTION))
        ]);
        setProjects(withoutTrashed(projectsSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
        setPipeline(withoutTrashed(pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
        setParts(withoutTrashed(partsSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
        setSectorRecords(sectorsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoaded(true);
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading addresses.");
        setLoaded(true);
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildings = useMemo(
    () => applyBuildingSectors(collectAddresses({ projects, pipeline, parts }), sectorRecords),
    [projects, pipeline, parts, sectorRecords]
  );
  const facets = useMemo(() => addressFacets(buildings), [buildings]);

  const ADDRESS_SORTS = {
    address: { kind: "text", get: b => b.label, label: "Address" },
    jobs: { kind: "money", get: b => b.total, label: "How much work" },
    latest: { kind: "date", get: b => b.latest, label: "Most recent" }
  };
  const shown = useMemo(
    () => sortRows(filterBuildings(buildings, { search, sector, firm, kind }), ADDRESS_SORTS, sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildings, search, sector, firm, kind, sort]
  );

  const filtered = Boolean(search.trim() || sector || firm || kind);
  const clearFilters = () => { setSearch(""); setSector(""); setFirm(""); setKind(""); };

  const duplicateGroups = useMemo(() => groupSimilarAddresses(buildings), [buildings]);

  // Exports exactly what's on the screen, filters and all.
  const exportAddresses = (format) => downloadTable({
    format,
    filename: `project-addresses${filtered ? "-filtered" : ""}-${csvDateStamp()}`,
    sheetName: "Project Addresses",
    headers: ["Address", "Jobs", "Projects", "Pipeline entries", "Parts orders", "Sectors", "Firms", "Most recent"],
    rows: shown.map(b => [
      b.label, b.total, b.counts.Project, b.counts.Pipeline, b.counts.Parts,
      (b.sectors || []).join("; "), (b.firms || []).join("; "), b.latest
    ])
  });

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn&apos;t load addresses</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory")}>Back to Directory</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} profile={myProfile} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Project Addresses</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory")}>← Back to Directory</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="toolbar">
        <input
          className="field"
          placeholder="Search by address, firm, person or sector..."
          aria-label="Search addresses"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, marginBottom: 0 }}
        />
        <SortPicker id="addresses-sort" options={ADDRESS_SORTS} sort={sort} onChange={setSort} />
        <ExportButtons label="these addresses" buttonText="Export page" onExport={exportAddresses} disabled={!shown.length} />
      </div>

      <div className="toolbar">
        <select className="field" aria-label="Filter by sector" value={sector} onChange={e => setSector(e.target.value)} style={{ marginBottom: 0 }}>
          <option value="">Sector: ALL</option>
          {facets.sectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select className="field" aria-label="Filter by firm" value={firm} onChange={e => setFirm(e.target.value)} style={{ marginBottom: 0 }}>
          <option value="">Firm: ALL</option>
          {facets.firms.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <select className="field" aria-label="Filter by what kind of work" value={kind} onChange={e => setKind(e.target.value)} style={{ marginBottom: 0 }}>
          <option value="">Work: ALL</option>
          <option value="Project">Has projects</option>
          <option value="Pipeline">Has pipeline entries</option>
          <option value="Parts">Has parts orders</option>
        </select>

        {filtered && (
          <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      {!loaded && <p className="modal-subtitle">Loading addresses...</p>}

      {loaded && duplicateGroups.length > 0 && !filtered && (
        <div className="review-banner" style={{ marginBottom: 14, display: "block" }}>
          <div style={{ marginBottom: 6 }}>
            ⚠ {duplicateGroups.length} {duplicateGroups.length === 1 ? "building looks" : "buildings look"} like the same place written two ways.
            Opening one shows everything filed under that spelling.
          </div>
          {duplicateGroups.map((group, i) => (
            <div key={`dupe-${i}`} className="private-note-hint" style={{ marginTop: 4 }}>
              {group.map((b, j) => (
                <span key={b.key}>
                  {j > 0 && " · "}
                  <button
                    type="button"
                    className="link-muted matching-select-link"
                    onClick={() => router.push(`/dashboard/directory/address/${addressKey(b.label)}`)}
                  >
                    {b.label} ({b.total})
                  </button>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      {loaded && (
        <p className="analytics-card-sub" style={{ marginTop: 0 }}>
          {shown.length} {shown.length === 1 ? "address" : "addresses"}{filtered && " (filtered)"}
        </p>
      )}

      {loaded && shown.length === 0 && (
        <p className="private-note-hint">
          {filtered ? "No addresses match that." : "No addresses yet. They appear here as soon as work has one."}
        </p>
      )}

      {shown.map(b => (
        <div
          key={b.key}
          className="customer-card"
          style={{ cursor: "pointer" }}
          onClick={() => router.push(`/dashboard/directory/address/${addressKey(b.label)}`)}
        >
          <div className="customer-card-left">
            <div className="customer-name">{b.label}</div>
            <div className="customer-meta" style={{ marginTop: 4 }}>
              {b.total} {b.total === 1 ? "job" : "jobs"} on file
            </div>
            {b.sectors.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {b.sectors.map(s => <span key={`s-${s}`} className="role-badge">{s}</span>)}
              </div>
            )}
          </div>
          <div className="customer-card-middle">
            <div className="private-note-hint">
              {[
                b.counts.Project && `${b.counts.Project} project${b.counts.Project === 1 ? "" : "s"}`,
                b.counts.Pipeline && `${b.counts.Pipeline} pipeline`,
                b.counts.Parts && `${b.counts.Parts} parts`
              ].filter(Boolean).join(" · ")}
            </div>
            {b.latest && <div className="customer-dates">Most recent: {b.latest}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AddressesPage() {
  return (
    <Suspense fallback={<div className="dashboard-page">Loading...</div>}>
      <AddressesPageContent />
    </Suspense>
  );
}
