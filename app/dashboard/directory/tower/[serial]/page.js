"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../../../../../lib/firebase";
import { doc, getDoc, getDocs, collection } from "firebase/firestore";
import { equipmentRowsFrom } from "../../../../../lib/equipment";
import DashboardHeader from "../../../../components/DashboardHeader";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

// A record can carry equipment for more than one physical tower now, so
// matching (and pulling manufacturer/model for display) has to look at
// whichever specific equipment row actually has this serial, not just any
// truthy field anywhere on the record.
const matchingRow = (record, key) => equipmentRowsFrom(record).find(r => r.serial.trim().toLowerCase() === key);

export default function TowerDetail() {
  const params = useParams();
  const router = useRouter();
  const serial = decodeURIComponent(params.serial || "");

  const [uid, setUid] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const [projects, setProjects] = useState([]);
  const [pipelineJobs, setPipelineJobs] = useState([]);
  const [towerModel, setTowerModel] = useState(null);

  const loadTower = async () => {
    const [customersSnap, pipelineSnap, towerModelsSnap] = await Promise.all([
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "pipeline")),
      getDocs(collection(db, "towerModels"))
    ]);

    const key = serial.trim().toLowerCase();
    const matchingCustomers = customersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => matchingRow(c, key));
    const matchingPipeline = pipelineSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => matchingRow(p, key));

    setProjects(matchingCustomers);
    setPipelineJobs(matchingPipeline);

    const firstMatch = matchingRow(matchingCustomers[0] || {}, key) || matchingRow(matchingPipeline[0] || {}, key) || {};
    const manufacturer = firstMatch.manufacturer || "";
    const model = firstMatch.model || "";
    const mfrLower = manufacturer.toLowerCase();
    const modelLower = model.toLowerCase();
    const matchedModel = towerModelsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .find(t => (t.manufacturer || "").toLowerCase() === mfrLower && (t.model || "").toLowerCase() === modelLower);
    setTowerModel(matchedModel || null);

    setLoaded(true);
  };

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
        if (profileSnap.data().disabled) {
          clearSession();
          await signOut(auth);
          router.push("/");
          return;
        }

        await loadTower();
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading this tower.");
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial]);

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load this tower</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory/towers")}>Back to Towers</button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <div className="dashboard-page">Loading...</div>;
  }

  if (projects.length === 0 && pipelineJobs.length === 0) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Tower not found</h3>
          <p className="modal-subtitle">No work is on file for serial number "{serial}".</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory/towers")}>Back to Towers</button>
        </div>
      </div>
    );
  }

  const displayKey = serial.trim().toLowerCase();
  const displayMatch = matchingRow(projects[0] || {}, displayKey) || matchingRow(pipelineJobs[0] || {}, displayKey) || {};
  const manufacturer = displayMatch.manufacturer || "";
  const model = displayMatch.model || "";

  // Every distinct company/contact pair that touched this tower, across
  // both the project's own company/contact and every contractor bidding
  // on any pipeline entry -- deduped so the same firm/person shows once.
  const peopleMap = new Map();
  const addPerson = (companyName, contactName, role) => {
    const company = (companyName || "").trim();
    const contact = (contactName || "").trim();
    if (!company && !contact) return;
    const key = `${company.toLowerCase()}|${contact.toLowerCase()}`;
    if (!peopleMap.has(key)) {
      peopleMap.set(key, { company, contact, roles: new Set() });
    }
    peopleMap.get(key).roles.add(role);
  };

  projects.forEach(p => addPerson(p.company, p.contact, "Customer"));
  pipelineJobs.forEach(p => {
    addPerson(p.company, p.contact, "Engineering Firm");
    (p.biddingCompanies || []).forEach(b => addPerson(b.company, b.contact, "Contractor"));
  });

  const associated = Array.from(peopleMap.values());

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Tower</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory/towers")}>← Back to Towers</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <div className="project-section">
          <h2 className="modal-title" style={{ marginBottom: 2 }}>Serial #{serial}</h2>
          <p><strong>Manufacturer:</strong> {manufacturer || "—"}</p>
          <p><strong>Model Number:</strong> {model || "—"}</p>
          {towerModel && (
            <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => router.push(`/dashboard/directory/tower-model/${towerModel.id}`)}>
              View Model Drawings ({(towerModel.drawings || []).length})
            </button>
          )}
          {!towerModel && (manufacturer || model) && (
            <p className="private-note-hint" style={{ marginTop: 8 }}>No drawings on file for this model yet.</p>
          )}
        </div>

        <div className="project-section">
          <h4 className="field-label">Projects ({projects.length})</h4>
          {projects.length === 0 && <p className="private-note-hint">No projects reference this tower.</p>}
          {projects.map(p => (
            <div key={p.id} className="notes-history-item" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/project/${p.id}`)}>
              <div><strong>{p.projectName || p.company}</strong></div>
              <div className="notes-history-date">{p.company || "—"}{p.category ? ` · ${p.category}` : ""}</div>
            </div>
          ))}
        </div>

        <div className="project-section">
          <h4 className="field-label">Pipeline Entries ({pipelineJobs.length})</h4>
          {pipelineJobs.length === 0 && <p className="private-note-hint">No pipeline entries reference this tower.</p>}
          {pipelineJobs.map(p => (
            <div key={p.id} className="notes-history-item" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/pipeline/${p.id}`)}>
              <div><strong>{p.title}</strong></div>
              <div className="notes-history-date">{p.stage}{p.bidDate ? ` · Bid: ${p.bidDate}` : ""}</div>
            </div>
          ))}
        </div>

        <div className="project-section">
          <h4 className="field-label">Contractors & People Associated With This Tower</h4>
          {associated.length === 0 && <p className="private-note-hint">None on file.</p>}
          {associated.map((a, i) => (
            <div key={i} className="notes-history-item">
              <div><strong>{a.company || "—"}</strong>{a.contact ? ` — ${a.contact}` : ""}</div>
              <div className="notes-history-date">{Array.from(a.roles).join(", ")}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
