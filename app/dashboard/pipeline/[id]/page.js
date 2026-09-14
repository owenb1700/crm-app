"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db, storage } from "../../../../lib/firebase";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  getDocs,
  arrayUnion,
  arrayRemove
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { ensureCompanyAndContactBatch, firmTypeOf } from "../../../../lib/directory";
import FirmTypeSelect from "../../../components/FirmTypeSelect";
import BuildingSectorSelect from "../../../components/BuildingSectorSelect";
import { ensureTowerModel } from "../../../../lib/towerModels";
import CompanyContactFields from "../../../components/CompanyContactFields";
import AddressAutocomplete from "../../../components/AddressAutocomplete";
import DashboardHeader from "../../../components/DashboardHeader";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const PIPELINE_STAGE_OPTIONS = ["Pre-Bid", "Bidding", "Design", "Budgeting"];

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

const EDITABLE_FIELDS = ["title", "buildingSector", "stage", "bidDate", "value", "company", "contact", "email", "phone", "projectAddress", "towerManufacturer", "modelNumber", "serialNumber", "salespersonId", "projectPointPersonId"];

const formatBytes = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function PipelineDetail() {
  const params = useParams();
  const router = useRouter();
  const pipelineId = params.id;

  const [uid, setUid] = useState(null);
  const [role, setRole] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [pipeline, setPipeline] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [towerModels, setTowerModels] = useState([]);
  const [privateData, setPrivateData] = useState(null);
  const [modalNotes, setModalNotes] = useState("");

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [biddingRows, setBiddingRows] = useState([]);

  const [uploading, setUploading] = useState(false);

  const [showConvertModal, setShowConvertModal] = useState(false);
  const [showWonModal, setShowWonModal] = useState(false);
  const [wonContractor, setWonContractor] = useState("");
  const [showLostModal, setShowLostModal] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostTo, setLostTo] = useState("");
  const [convertNextDate, setConvertNextDate] = useState("");
  const [convertProjectAddress, setConvertProjectAddress] = useState("");

  const formatPhone = (phone) => {
    if (!phone) return "";
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) return phone;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const adjustWeekend = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    if (day === 6) d.setDate(d.getDate() + 2);
    if (day === 0) d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  };

  const ownerLabel = (ownerId) => {
    if (ownerId === uid) return "You";
    const u = users.find(u => u.id === ownerId);
    if (!u) return "Teammate";
    return u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email;
  };

  const loadPipelineEntry = async (currentUid, currentRole) => {
    const snap = await getDoc(doc(db, "pipeline", pipelineId));
    if (!snap.exists()) {
      setNotFound(true);
      return;
    }
    const data = { id: snap.id, ...snap.data() };
    setPipeline(data);

    const [usersSnap, companiesSnap, contactsSnap, towerModelsSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "companies")),
      getDocs(collection(db, "contacts")),
      getDocs(collection(db, "towerModels"))
    ]);
    setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setTowerModels(towerModelsSnap.docs.map(d => ({ id: d.id, ...d.data() })));

    const isOwner = data.ownerId === currentUid;

    if (isOwner || currentRole === "admin") {
      try {
        const privSnap = await getDoc(doc(db, "pipeline", pipelineId, "private", "data"));
        const priv = privSnap.exists() ? privSnap.data() : { notes: "", notesHistory: [], files: [] };
        setPrivateData(priv);
        setModalNotes(priv.notes || "");
      } catch {
        setPrivateData(null);
      }
    }
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
        const profile = profileSnap.data();

        if (profile.disabled) {
          clearSession();
          await signOut(auth);
          router.push("/");
          return;
        }

        setMyProfile(profile);
        setRole(profile.role || "member");
        await loadPipelineEntry(user.uid, profile.role || "member");
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading this pipeline entry.");
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId]);

  const isOwner = pipeline && pipeline.ownerId === uid;
  const canSeeNotes = isOwner || role === "admin";
  // Contractors Bidding and every other project detail are team-editable --
  // only the private notes/files and the destructive actions (delete,
  // convert to project) stay restricted to the owner/admin.
  const canEdit = !!pipeline;
  const canEditPrivate = isOwner;
  const canDelete = isOwner || role === "admin";

  const startEdit = () => {
    setEditData({
      title: pipeline.title || "",
      stage: pipeline.stage || "Pre-Bid",
      buildingSector: pipeline.buildingSector || "",
      bidDate: pipeline.bidDate || "",
      value: pipeline.value || "",
      company: pipeline.company || "",
      contact: pipeline.contact || "",
      email: pipeline.email || "",
      phone: pipeline.phone || "",
      projectAddress: pipeline.projectAddress || "",
      towerManufacturer: pipeline.towerManufacturer || "",
      modelNumber: pipeline.modelNumber || "",
      serialNumber: pipeline.serialNumber || "",
      salespersonId: pipeline.salespersonId || "",
      projectPointPersonId: pipeline.projectPointPersonId || ""
    });
    setBiddingRows(pipeline.biddingCompanies || []);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditData({});
    setBiddingRows([]);
  };

  const addBiddingRow = () => {
    setBiddingRows(prev => [...prev, { category: "Contractor", company: "", contact: "", email: "", phone: "" }]);
  };

  const updateBiddingRow = (index, field, value) => {
    setBiddingRows(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const removeBiddingRow = (index) => {
    setBiddingRows(prev => prev.filter((_, i) => i !== index));
  };

  const saveEdit = async () => {
    if (!editData.title) {
      return alert("Project/opportunity name is required");
    }
    if (!editData.buildingSector) {
      return alert("Please select a building sector");
    }

    const payload = {};
    EDITABLE_FIELDS.forEach(f => {
      payload[f] = editData[f] || null;
    });
    payload.biddingCompanies = biddingRows.filter(r => r.company || r.contact);

    await updateDoc(doc(db, "pipeline", pipelineId), payload);

    const captureEntries = [
      { companyName: editData.company, category: "Engineering Firm", contactName: editData.contact, email: editData.email, phone: editData.phone },
      ...biddingRows
        .filter(r => r.company || r.contact)
        .map(r => ({ companyName: r.company, category: firmTypeOf(r.category), contactName: r.contact, email: r.email, phone: r.phone }))
    ];
    await ensureCompanyAndContactBatch(captureEntries, { companies, contacts, uid });
    await ensureTowerModel({ towerModels, manufacturer: editData.towerManufacturer, model: editData.modelNumber, uid });

    setIsEditing(false);
    await loadPipelineEntry(uid, role);
  };

  const saveNotes = async () => {
    const existing = privateData || { notes: "", notesHistory: [], files: [] };
    const original = existing.notes || "";
    const changed = original !== modalNotes;
    const myName = myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : (auth.currentUser?.email || "Unknown");

    const ref2 = doc(db, "pipeline", pipelineId, "private", "data");

    const newHistory = changed && original
      ? [
          ...(existing.notesHistory || []),
          { text: original, date: new Date().toISOString(), authorName: myName }
        ]
      : existing.notesHistory || [];

    await setDoc(ref2, {
      ...existing,
      notes: modalNotes,
      notesAuthorName: myName,
      notesHistory: newHistory
    });

    await loadPipelineEntry(uid, role);
  };

  const deleteHistoryEntry = async (index) => {
    if (!window.confirm("Delete this note entry? This can't be undone.")) return;

    const existing = privateData || { notesHistory: [] };
    const newHistory = (existing.notesHistory || []).filter((_, i) => i !== index);

    await setDoc(doc(db, "pipeline", pipelineId, "private", "data"), {
      ...existing,
      notesHistory: newHistory
    });

    await loadPipelineEntry(uid, role);
  };

  const uploadFile = async (fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      return alert("Only PDF files can be uploaded here");
    }

    setUploading(true);
    try {
      const path = `pipeline/${pipelineId}/${Date.now()}-${file.name}`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);

      const newFile = {
        name: file.name,
        path,
        url,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        uploadedByName: myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : (auth.currentUser?.email || "Unknown")
      };

      const existing = privateData || { notes: "", notesHistory: [], files: [] };
      await setDoc(doc(db, "pipeline", pipelineId, "private", "data"), {
        ...existing,
        files: [...(existing.files || []), newFile]
      });

      await loadPipelineEntry(uid, role);
    } catch (err) {
      alert(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const deleteFile = async (file) => {
    if (!window.confirm(`Delete "${file.name}"? This can't be undone.`)) return;

    try {
      await deleteObject(ref(storage, file.path));
    } catch {
      // file may already be gone from storage; still clean up the metadata
    }

    const existing = privateData || { files: [] };
    await setDoc(doc(db, "pipeline", pipelineId, "private", "data"), {
      ...existing,
      files: (existing.files || []).filter(f => f.path !== file.path)
    });

    await loadPipelineEntry(uid, role);
  };

  const deletePipeline = async () => {
    if (!window.confirm("Delete this pipeline entry? This can't be undone.")) return;
    await deleteDoc(doc(db, "pipeline", pipelineId));
    router.push("/dashboard");
  };

  // Lets anyone track a pipeline entry on their own My Dashboard without
  // needing to be the owner or assigned as salesperson/point person --
  // this just toggles their uid in the shared array on the one document,
  // so it's always mirrored everywhere the entry shows up.
  const isTracked = !!pipeline && (pipeline.trackedByIds || []).includes(uid);

  const toggleTracked = async () => {
    await updateDoc(doc(db, "pipeline", pipelineId), {
      trackedByIds: isTracked ? arrayRemove(uid) : arrayUnion(uid)
    });
    await loadPipelineEntry(uid, role);
  };

  const confirmMarkWon = async () => {
    if (!wonContractor.trim()) return alert("Enter or select the winning contractor");

    // Won work gets a 1-year check-in with whoever's actually responsible
    // for the relationship (point person, then salesperson, then owner) --
    // same follow-up/snooze pattern as a closed project. Lost work never
    // gets a nextCheckIn at all, so it's never followed up on.
    const followUp = new Date();
    followUp.setFullYear(followUp.getFullYear() + 1);

    await updateDoc(doc(db, "pipeline", pipelineId), {
      outcome: "Won",
      wonByContractor: wonContractor.trim(),
      resolvedAt: new Date().toISOString(),
      nextCheckIn: adjustWeekend(followUp.toISOString())
    });
    setShowWonModal(false);
    setWonContractor("");
    await loadPipelineEntry(uid, role);
  };

  const confirmMarkLost = async () => {
    if (!lostReason.trim()) return alert("Enter why this was lost");
    await updateDoc(doc(db, "pipeline", pipelineId), {
      outcome: "Lost",
      wonByContractor: null,
      lostReason: lostReason.trim(),
      lostTo: lostTo.trim() || null,
      resolvedAt: new Date().toISOString(),
      nextCheckIn: null
    });
    setShowLostModal(false);
    setLostReason("");
    setLostTo("");
    await loadPipelineEntry(uid, role);
  };

  const reopenPipeline = async () => {
    await updateDoc(doc(db, "pipeline", pipelineId), {
      outcome: null,
      wonByContractor: null,
      lostReason: null,
      lostTo: null,
      resolvedAt: null,
      nextCheckIn: null
    });
    await loadPipelineEntry(uid, role);
  };

  const convertToProject = async () => {
    if (!convertNextDate) {
      return alert("Pick a next check-in date for the new project");
    }
    if (!convertProjectAddress) {
      return alert("A project address is required");
    }

    const ref3 = await addDoc(collection(db, "customers"), {
      projectName: pipeline.title,
      company: pipeline.company || "",
      contact: pipeline.contact || "",
      email: pipeline.email || "",
      phone: pipeline.phone || "",
      category: "Ongoing Project",
      buildingSector: pipeline.buildingSector || null,
      projectValue: pipeline.value || null,
      projectAddress: convertProjectAddress,
      towerManufacturer: pipeline.towerManufacturer || null,
      modelNumber: pipeline.modelNumber || null,
      serialNumber: pipeline.serialNumber || null,
      nextCheckIn: adjustWeekend(convertNextDate),
      lastContact: new Date().toISOString().split("T")[0],
      activityLog: [],
      ownerId: pipeline.ownerId,
      collaboratorIds: [],
      createdAt: new Date().toISOString()
    });

    await setDoc(doc(db, "customers", ref3.id, "private", "data"), {
      notes: privateData?.notes || "",
      notesHistory: privateData?.notesHistory || []
    });

    await updateDoc(doc(db, "pipeline", pipelineId), {
      convertedToProjectId: ref3.id,
      convertedAt: new Date().toISOString()
    });

    router.push(`/dashboard/project/${ref3.id}`);
  };

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load this entry</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Pipeline entry not found</h3>
          <p className="modal-subtitle">It may have been deleted.</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (!pipeline || !role) {
    return <div className="dashboard-page">Loading...</div>;
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Pipeline Entry</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>← Back to Dashboard</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <div className="project-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div>
              <h2 className="modal-title" style={{ marginBottom: 2 }}>{pipeline.title}</h2>
              <p className="modal-subtitle">Owned by {ownerLabel(pipeline.ownerId)}</p>
              <span className="role-badge role-badge-admin" style={{ marginTop: 6 }}>{pipeline.stage}</span>
              <p className="modal-subtitle" style={{ marginTop: 6 }}>Building Sector: {pipeline.buildingSector || "Not set"}</p>
              {pipeline.value && <p className="modal-subtitle" style={{ marginTop: 6 }}>Value: {pipeline.value}</p>}
              {pipeline.convertedToProjectId && (
                <p className="modal-subtitle" style={{ marginTop: 6 }}>
                  ✅ Converted —{" "}
                  <a className="link-muted" href={`/dashboard/project/${pipeline.convertedToProjectId}`}>
                    View project
                  </a>
                </p>
              )}
            </div>

            {canEdit && !isEditing && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary" onClick={toggleTracked}>
                  {isTracked ? "Remove From My Dashboard" : "Add To My Dashboard"}
                </button>
                <button className="btn btn-primary" onClick={startEdit}>Edit</button>
                {canDelete && <button className="btn btn-danger" onClick={deletePipeline}>Delete</button>}
              </div>
            )}
            {isEditing && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" onClick={saveEdit}>Save</button>
                <button className="btn btn-secondary" onClick={cancelEdit}>Cancel</button>
              </div>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="project-section">
            <h4 className="field-label">Project / Opportunity Name</h4>
            <input className="field" name="pd-title" autoComplete="off" value={editData.title} onChange={e => setEditData({ ...editData, title: e.target.value })} />

            <div className="form-grid-2">
              <BuildingSectorSelect id="pipeline-detail-sector" value={editData.buildingSector} onChange={v => setEditData({ ...editData, buildingSector: v })} />
              <div>
                <h4 className="field-label">Stage</h4>
                <select className="field" value={editData.stage} onChange={e => setEditData({ ...editData, stage: e.target.value })}>
                  {PIPELINE_STAGE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              <div>
                <h4 className="field-label">Bid Date</h4>
                <input className="field" type="date" value={editData.bidDate} onChange={e => setEditData({ ...editData, bidDate: e.target.value })} />
              </div>

              <div>
                <h4 className="field-label">Estimated Value</h4>
                <input className="field" name="pd-value" autoComplete="off" value={editData.value} onChange={e => setEditData({ ...editData, value: e.target.value })} />
              </div>
              <CompanyContactFields
                idPrefix="pipeline-detail"
                companies={companies}
                contacts={contacts}
                companyLabel="Engineering Firm"
                companyCategory="Engineering Firm"
                companyValue={editData.company}
                contactValue={editData.contact}
                emailValue={editData.email}
                phoneValue={editData.phone}
                onCompanyChange={v => setEditData({ ...editData, company: v })}
                onContactChange={v => setEditData({ ...editData, contact: v })}
                onEmailChange={v => setEditData({ ...editData, email: v })}
                onPhoneChange={v => setEditData({ ...editData, phone: v })}
              />

              <h4 className="field-label" style={{ marginTop: 12 }}>Project Address</h4>
              <AddressAutocomplete name="pipeline-detail-projectAddress" value={editData.projectAddress} onChange={v => setEditData({ ...editData, projectAddress: v })} />
            </div>

            <h4 className="field-label" style={{ marginTop: 16 }}>Contractors & Owners Bidding</h4>
            {biddingRows.map((row, i) => (
              <div key={i} className="bidding-company-row with-type">
                <FirmTypeSelect id={`pipeline-detail-bidder-type-${i}`} value={firmTypeOf(row.category)} onChange={v => updateBiddingRow(i, "category", v)} />
                <CompanyContactFields
                  idPrefix={`pipeline-detail-bidder-${i}`}
                  companies={companies}
                  contacts={contacts}
                  companyLabel={firmTypeOf(row.category)}
                  companyCategory={firmTypeOf(row.category)}
                  companyValue={row.company}
                  contactValue={row.contact}
                  emailValue={row.email}
                  phoneValue={row.phone}
                  onCompanyChange={v => updateBiddingRow(i, "company", v)}
                  onContactChange={v => updateBiddingRow(i, "contact", v)}
                  onEmailChange={v => updateBiddingRow(i, "email", v)}
                  onPhoneChange={v => updateBiddingRow(i, "phone", v)}
                />
                <button className="btn btn-danger" onClick={() => removeBiddingRow(i)}>Remove</button>
              </div>
            ))}
            <button className="btn btn-secondary" onClick={addBiddingRow}>+ Add Bidder</button>

            <h4 className="field-label" style={{ marginTop: 16 }}>Assigned Team</h4>
            <div className="form-grid-2">
              <div>
                <label className="field-label">Salesperson</label>
                <select className="field" value={editData.salespersonId} onChange={e => setEditData({ ...editData, salespersonId: e.target.value })}>
                  <option value="">Unassigned</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Project Point Person</label>
                <select className="field" value={editData.projectPointPersonId} onChange={e => setEditData({ ...editData, projectPointPersonId: e.target.value })}>
                  <option value="">Unassigned</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email}</option>
                  ))}
                </select>
              </div>
            </div>

            <h4 className="field-label" style={{ marginTop: 16 }}>Tower Details</h4>
            <div className="form-grid-2">
              <div>
                <label className="field-label">Tower Manufacturer</label>
                <input className="field" name="pipeline-detail-towerManufacturer" autoComplete="off" value={editData.towerManufacturer} onChange={e => setEditData({ ...editData, towerManufacturer: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Model Number</label>
                <input className="field" name="pipeline-detail-modelNumber" autoComplete="off" value={editData.modelNumber} onChange={e => setEditData({ ...editData, modelNumber: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Serial Number</label>
                <input className="field" name="pipeline-detail-serialNumber" autoComplete="off" value={editData.serialNumber} onChange={e => setEditData({ ...editData, serialNumber: e.target.value })} />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="project-section">
              <h4 className="field-label">Contact Info</h4>
              <p><strong>Engineering Firm:</strong> {pipeline.company || "—"}</p>
              <p><strong>Contact:</strong> {pipeline.contact || "—"}</p>
              <p><strong>Email:</strong> {pipeline.email || "—"}</p>
              <p><strong>Phone:</strong> {formatPhone(pipeline.phone) || "—"}</p>
              <p><strong>Project Address:</strong> {pipeline.projectAddress || "—"}</p>
            </div>

            <div className="project-section">
              <h4 className="field-label">Bid Info</h4>
              <p><strong>Bid Date:</strong> {pipeline.bidDate || "—"}</p>
              <p><strong>Estimated Value:</strong> {pipeline.value || "—"}</p>
            </div>

            <div className="project-section">
              <h4 className="field-label">Assigned Team</h4>
              <p><strong>Salesperson:</strong> {pipeline.salespersonId ? ownerLabel(pipeline.salespersonId) : "Unassigned"}</p>
              <p><strong>Project Point Person:</strong> {pipeline.projectPointPersonId ? ownerLabel(pipeline.projectPointPersonId) : "Unassigned"}</p>
            </div>

            <div className="project-section">
              <h4 className="field-label">Contractors & Owners Bidding</h4>
              {(pipeline.biddingCompanies || []).length === 0 && (
                <p className="private-note-hint">None added yet.</p>
              )}
              {(pipeline.biddingCompanies || []).map((row, i) => (
                <div key={i} className="notes-history-item">
                  <div><strong>{row.company}</strong>{row.contact ? ` — ${row.contact}` : ""}</div>
                  <div className="notes-history-date">{firmTypeOf(row.category)}</div>
                  <div className="notes-history-date">{[row.email, formatPhone(row.phone)].filter(Boolean).join(" | ")}</div>
                </div>
              ))}
            </div>

            <div className="project-section">
              <h4 className="field-label">Tower Details</h4>
              <p><strong>Tower Manufacturer:</strong> {pipeline.towerManufacturer || "—"}</p>
              <p><strong>Model Number:</strong> {pipeline.modelNumber || "—"}</p>
              <p><strong>Serial Number:</strong> {pipeline.serialNumber || "—"}</p>
            </div>
          </>
        )}

        <div className="project-section">
          <h4 className="field-label">Outcome</h4>
          {!pipeline.outcome && (
            <>
              <p className="private-note-hint">Still in progress.</p>
              {canEdit && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary" onClick={() => setShowWonModal(true)}>Mark Won</button>
                  <button className="btn btn-danger" onClick={() => setShowLostModal(true)}>Mark Lost</button>
                </div>
              )}
            </>
          )}
          {pipeline.outcome === "Won" && (
            <>
              <p>✅ <strong>Won</strong>{pipeline.wonByContractor ? ` — awarded to ${pipeline.wonByContractor}` : ""}</p>
              {pipeline.nextCheckIn && (
                <p className="private-note-hint">Follow-up check-in scheduled: {pipeline.nextCheckIn}</p>
              )}
              {canEdit && <button className="btn btn-secondary" onClick={reopenPipeline}>Reopen</button>}
            </>
          )}
          {pipeline.outcome === "Lost" && (
            <>
              <p>❌ <strong>Lost</strong>{pipeline.resolvedAt ? ` on ${pipeline.resolvedAt.slice(0, 10)}` : ""}</p>
              <p><strong>Why:</strong> {pipeline.lostReason || "No reason recorded"}</p>
              <p><strong>Won by:</strong> {pipeline.lostTo || "Not recorded"}</p>
              {canEdit && <button className="btn btn-secondary" onClick={reopenPipeline}>Reopen</button>}
            </>
          )}
        </div>

        {isOwner && !pipeline.convertedToProjectId && (
          <div className="project-section">
            <h4 className="field-label">Convert to Project</h4>
            <p className="private-note-hint">Won the project? Turn this pipeline entry into a real project.</p>
            <button className="btn btn-primary" onClick={() => { setConvertProjectAddress(pipeline.projectAddress || ""); setShowConvertModal(true); }}>Convert to Project</button>
          </div>
        )}

        <div className="project-section">
          <h4 className="field-label">Notes</h4>

          {!canSeeNotes && (
            <p className="private-note-hint">🔒 Notes are private to {ownerLabel(pipeline.ownerId)}.</p>
          )}

          {canSeeNotes && !canEditPrivate && (
            <>
              <p>{privateData?.notes || "(no notes yet)"}</p>
              {privateData?.notesAuthorName && (
                <p className="private-note-hint">Last written by {privateData.notesAuthorName}</p>
              )}
            </>
          )}

          {canEditPrivate && (
            <>
              {privateData?.notesAuthorName && (
                <p className="private-note-hint">Last written by {privateData.notesAuthorName}</p>
              )}
              <textarea
                className="field"
                name="pd-notes"
                autoComplete="off"
                style={{ width: "100%", height: 100 }}
                value={modalNotes}
                onChange={e => setModalNotes(e.target.value)}
              />
              <button className="btn btn-primary" onClick={saveNotes}>Save Notes</button>
            </>
          )}

          {canSeeNotes && (privateData?.notesHistory || []).length > 0 && (
            <>
              <h4 className="field-label" style={{ marginTop: 16 }}>Notes History</h4>
              {privateData.notesHistory.map((h, i) => (
                <div key={i} className="notes-history-item notes-history-row">
                  <div>
                    <div>{h.text}</div>
                    <div className="notes-history-date">{h.authorName || "Unknown"} · {h.date}</div>
                  </div>
                  {canEditPrivate && (
                    <button className="btn btn-danger" onClick={() => deleteHistoryEntry(i)}>Delete</button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="project-section">
          <h4 className="field-label">Files (PDF)</h4>

          {!canSeeNotes && (
            <p className="private-note-hint">🔒 Files are private to {ownerLabel(pipeline.ownerId)}.</p>
          )}

          {canSeeNotes && (
            <>
              {(privateData?.files || []).length === 0 && (
                <p className="private-note-hint">No files uploaded yet.</p>
              )}
              {(privateData?.files || []).map((f, i) => (
                <div key={i} className="notes-history-item notes-history-row">
                  <div>
                    <a className="link-muted" href={f.url} target="_blank" rel="noopener noreferrer">{f.name}</a>
                    <div className="notes-history-date">
                      {formatBytes(f.size)} · uploaded by {f.uploadedByName} · {f.uploadedAt?.slice(0, 10)}
                    </div>
                  </div>
                  {canEditPrivate && (
                    <button className="btn btn-danger" onClick={() => deleteFile(f)}>Delete</button>
                  )}
                </div>
              ))}

              {canEditPrivate && (
                <div style={{ marginTop: 12 }}>
                  <input
                    type="file"
                    accept="application/pdf"
                    disabled={uploading}
                    onChange={e => uploadFile(e.target.files)}
                  />
                  {uploading && <p className="private-note-hint">Uploading...</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showWonModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <button className="modal-close" onClick={() => setShowWonModal(false)}>✕</button>
            <h3 className="modal-title">Mark as Won</h3>
            <p className="modal-subtitle">Which contractor or owner won the job?</p>

            <label className="field-label">Winning Firm</label>
            <input className="field" list="won-contractor-options" autoComplete="off" value={wonContractor} onChange={e => setWonContractor(e.target.value)} />
            <datalist id="won-contractor-options">
              {Array.from(new Set((pipeline.biddingCompanies || []).map(b => b.company).filter(Boolean))).map(name => (
                <option key={name} value={name} />
              ))}
            </datalist>

            <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={confirmMarkWon}>Confirm</button>
          </div>
        </div>
      )}

      {showLostModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <button className="modal-close" onClick={() => setShowLostModal(false)}>✕</button>
            <h3 className="modal-title">Mark as Lost</h3>
            <p className="modal-subtitle">This shows in Past Projects so the team can see what happened.</p>

            <label className="field-label" htmlFor="pipeline-lost-reason">Why was it lost?</label>
            <textarea id="pipeline-lost-reason" className="field" style={{ width: "100%", height: 80 }} value={lostReason} onChange={e => setLostReason(e.target.value)} />

            <label className="field-label" htmlFor="pipeline-lost-to">Who won it? (optional)</label>
            <input id="pipeline-lost-to" className="field" list="pipeline-lost-to-options" autoComplete="off" value={lostTo} onChange={e => setLostTo(e.target.value)} />
            <datalist id="pipeline-lost-to-options">
              {Array.from(new Set([
                ...(pipeline.biddingCompanies || []).map(b => b.company),
                ...companies.map(c => c.name)
              ].filter(Boolean))).map(name => <option key={name} value={name} />)}
            </datalist>

            <div className="modal-actions">
              <button className="btn btn-danger" onClick={confirmMarkLost}>Mark Lost</button>
              <button className="btn btn-secondary" onClick={() => setShowLostModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showConvertModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <button className="modal-close" onClick={() => setShowConvertModal(false)}>✕</button>
            <h3 className="modal-title">Convert to Project</h3>
            <p className="modal-subtitle">
              This creates a new project from "{pipeline.title}" and marks this pipeline entry as converted.
            </p>

            <label className="field-label">Next Check-In Date</label>
            <input className="field" type="date" value={convertNextDate} onChange={e => setConvertNextDate(e.target.value)} />

            <label className="field-label">Project Address (required)</label>
            <AddressAutocomplete name="convert-projectAddress" value={convertProjectAddress} onChange={setConvertProjectAddress} />

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={convertToProject}>Create Project</button>
              <button className="btn btn-secondary" onClick={() => setShowConvertModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
