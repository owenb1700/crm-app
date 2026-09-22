"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { auth, db } from "../../../../../lib/firebase";
import { withoutTrashed } from "../../../../../lib/trash";
import { workAtAddress, collectAddresses, uniqueNames, normalizeAddress } from "../../../../../lib/addresses";
import { personName } from "../../../../../lib/people";
import { sortRows } from "../../../../../lib/sorting";
import SortableHeader from "../../../../components/SortableHeader";
import { downloadTable, csvDateStamp } from "../../../../../lib/csv";
import DashboardHeader from "../../../../components/DashboardHeader";
import MobileNav from "../../../../components/MobileNav";
import ExportButtons from "../../../../components/ExportButtons";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const clearSession = () => localStorage.removeItem("loginTimestamp");

// One building: everything worked on there, and who it was worked on with.
function AddressPageContent() {
  const params = useParams();
  const router = useRouter();
  const key = decodeURIComponent(params.key || "");

  const [uid, setUid] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [projects, setProjects] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [parts, setParts] = useState([]);
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [historySort, setHistorySort] = useState({ key: "date", direction: "desc" });

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

        const [projectsSnap, pipelineSnap, partsSnap, usersSnap, companiesSnap, contactsSnap] = await Promise.all([
          getDocs(collection(db, "customers")),
          getDocs(collection(db, "pipeline")),
          getDocs(collection(db, "parts")),
          getDocs(collection(db, "users")),
          getDocs(collection(db, "companies")),
          getDocs(collection(db, "contacts"))
        ]);
        setProjects(withoutTrashed(projectsSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
        setPipeline(withoutTrashed(pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
        setParts(partsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoaded(true);
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading this address.");
        setLoaded(true);
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The heading uses the fullest spelling on file, not whatever was in the URL.
  const label = useMemo(() => {
    const match = collectAddresses({ projects, pipeline, parts }).find(b => b.key === normalizeAddress(key));
    return match?.label || key;
  }, [projects, pipeline, parts, key]);

  const rows = useMemo(
    () => workAtAddress({ address: key, projects, pipeline, parts }),
    [key, projects, pipeline, parts]
  );

  const historyColumns = {
    name: { kind: "text", get: r => r.name },
    kind: { kind: "text", get: r => r.kind },
    status: { kind: "text", get: r => r.status },
    value: { kind: "money", get: r => r.value },
    date: { kind: "date", get: r => r.date },
    firms: { kind: "text", get: r => (r.firms || []).join(", ") }
  };
  const firms = uniqueNames(rows, "firms");
  const people = uniqueNames(rows, "people");
  const nameOf = (id) => (id ? personName(users.find(u => u.id === id)) : "");

  const companyIdFor = (name) => companies.find(c => c.name === name)?.id;
  const contactIdFor = (name) => contacts.find(c => c.name === name)?.id;

  const exportAddress = (format) => downloadTable({
    format,
    filename: `address-${normalizeAddress(label).replace(/\s+/g, "-").slice(0, 40)}-${csvDateStamp()}`,
    sheetName: "Work at address",
    headers: ["What", "Type", "Status", "Value", "Date", "Firms", "People", "Owner"],
    rows: rows.map(r => [r.name, r.kind, r.status, r.value, r.date, (r.firms || []).join("; "), (r.people || []).join("; "), nameOf(r.ownerId)])
  });

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn&apos;t load this address</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory/addresses")}>Back to Project Addresses</button>
        </div>
      </div>
    );
  }
  if (!loaded) return <div className="dashboard-page">Loading...</div>;

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} profile={myProfile} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">{label}</h1>
        </div>
        <div className="dashboard-header-actions">
          <ExportButtons label="this address" buttonText="Export" onExport={exportAddress} disabled={!rows.length} />
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory/addresses")}>← All addresses</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <div className="project-section">
          <h4 className="field-label">Firms we worked with here</h4>
          {firms.length === 0 ? <p className="private-note-hint">None on file.</p> : (
            <ul className="plain-list">
              {firms.map(f => (
                <li key={f}>
                  {companyIdFor(f)
                    ? <button type="button" className="link-muted matching-select-link" onClick={() => router.push(`/dashboard/directory/company/${companyIdFor(f)}`)}>{f}</button>
                    : f}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="project-section">
          <h4 className="field-label">People we worked with here</h4>
          {people.length === 0 ? <p className="private-note-hint">None on file.</p> : (
            <ul className="plain-list">
              {people.map(p => (
                <li key={p}>
                  {contactIdFor(p)
                    ? <button type="button" className="link-muted matching-select-link" onClick={() => router.push(`/dashboard/directory/person/${contactIdFor(p)}`)}>{p}</button>
                    : p}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="project-section detail-span-full">
          <h4 className="field-label">Everything at this address ({rows.length})</h4>
          {rows.length === 0 ? (
            <p className="private-note-hint">Nothing on file at this address.</p>
          ) : (
            <div className="analytics-table-wrap">
              <table className="analytics-table stack-on-phone">
                <thead>
                  <tr>
                    <SortableHeader label="What" columnKey="name" sort={historySort} onSort={setHistorySort} />
                    <SortableHeader label="Type" columnKey="kind" sort={historySort} onSort={setHistorySort} />
                    <SortableHeader label="Status" columnKey="status" sort={historySort} onSort={setHistorySort} />
                    <SortableHeader label="Value" columnKey="value" kind="money" sort={historySort} onSort={setHistorySort} />
                    <SortableHeader label="Date" columnKey="date" kind="date" sort={historySort} onSort={setHistorySort} />
                    <SortableHeader label="Firms" columnKey="firms" sort={historySort} onSort={setHistorySort} />
                  </tr>
                </thead>
                <tbody>
                  {sortRows(rows, historyColumns, historySort).map(row => (
                    <tr key={`${row.kind}-${row.id}`} style={{ cursor: "pointer" }} onClick={() => router.push(row.href)}>
                      <td data-label="What">{row.name}</td>
                      <td data-label="Type">{row.kind}</td>
                      <td data-label="Status">{row.status || "—"}</td>
                      <td data-label="Value">{row.value || "—"}</td>
                      <td data-label="Date">{row.date || "—"}</td>
                      <td data-label="Firms">{(row.firms || []).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AddressPage() {
  return (
    <Suspense fallback={<div className="dashboard-page">Loading...</div>}>
      <AddressPageContent />
    </Suspense>
  );
}
