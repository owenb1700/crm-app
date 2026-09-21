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
  collection,
  getDocs,
  query,
  where
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { ensureCompanyAndContactBatch, OWNER_CATEGORY, BLANK_OWNER_ROW, cleanOwnerRows, firmTypeOf } from "../../../../lib/directory";
import FirmTypeSelect from "../../../components/FirmTypeSelect";
import BuildingSectorSelect from "../../../components/BuildingSectorSelect";
import WorkTypeSelect from "../../../components/WorkTypeSelect";
import BidHistory from "../../../components/BidHistory";
import DeleteRecordButton from "../../../components/DeleteRecordButton";
import ClosedCheckInActions from "../../../components/ClosedCheckInActions";
import { closeProjectPayload, isClosedWithCheckIn, isCheckInDue } from "../../../../lib/closedProjects";
import { ensureTowerModel } from "../../../../lib/towerModels";
import { PRODUCT_TYPES, PRODUCT_MANUFACTURERS } from "../../../../lib/products";
import { equipmentRowsFrom as sharedEquipmentRowsFrom } from "../../../../lib/equipment";
import CompanyContactFields from "../../../components/CompanyContactFields";
import AddressAutocomplete from "../../../components/AddressAutocomplete";
import DashboardHeader from "../../../components/DashboardHeader";
import MoneyInput from "../../../components/MoneyInput";
import MobileNav from "../../../components/MobileNav";
import ProjectMyReminders from "../../../components/ProjectMyReminders";
import { isTrashed } from "../../../../lib/trash";
import PhotoGallery from "../../../components/PhotoGallery";
import CreditSplitEditor from "../../../components/CreditSplitEditor";
import { describeSplit, normalizeSplits, splitError, withSplitMembers } from "../../../../lib/splits";
import { stateChanges, activityEntry, withActivity } from "../../../../lib/activityLog";
import { notifyUsers, newSplitMembers } from "../../../../lib/notify";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
// Parts moved to their own tab (/dashboard/parts), so they're no longer
// a project status. Projects filed as Parts before the move keep the
// label until someone changes it.
const CATEGORY_OPTIONS = ["Pre-Bid", "Bidding", "Prospecting", "Ongoing Project", "Order", "Project Closed"];
const BLANK_EQUIPMENT_ROW = { type: "", manufacturer: "", model: "", serial: "", yearInstalled: "" };

const BACK_TARGETS = { personal: "My Projects", team: "Team page", pastProjects: "Past Projects" };

// The shared helper returns [] when a record has no equipment at all --
// fine for display, but the edit form always wants at least one row to
// show, so wrap it here for that one difference.
const equipmentRowsFrom = (customer) => {
  const rows = sharedEquipmentRowsFrom(customer);
  return rows.length ? rows : [{ ...BLANK_EQUIPMENT_ROW }];
};

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

const formatBytes = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const EDITABLE_FIELDS = [
  "projectName", "buildingSector", "company", "companyCategory", "contact", "email", "phone", "category", "projectValue", "workType",
  "nextCheckIn", "lastContact", "projectAddress"
];

export default function ProjectDetail() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id;

  const [uid, setUid] = useState(null);
  const [role, setRole] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [customer, setCustomer] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [towerModels, setTowerModels] = useState([]);
  const [notesData, setNotesData] = useState(null);
  const [modalNotes, setModalNotes] = useState("");
  const [drawingsData, setDrawingsData] = useState(null);
  const [uploadingDrawing, setUploadingDrawing] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [equipmentRows, setEquipmentRows] = useState([{ ...BLANK_EQUIPMENT_ROW }]);
  const [splitRows, setSplitRows] = useState([]);
  const [ownerRows, setOwnerRows] = useState([]);
  const [activeTab, setActiveTab] = useState("details"); // "details" | "bid"
  const [legacyBid, setLegacyBid] = useState(null);

  const updateOwnerRow = (index, field, value) => {
    setOwnerRows(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  // "?from=team" / "?from=pastProjects" is added by the list that opened
  // this project, so Back returns to the tab you were actually on.
  const [openedFrom] = useState(() => {
    if (typeof window === "undefined") return "personal";
    const from = new URLSearchParams(window.location.search).get("from");
    return BACK_TARGETS[from] ? from : "personal";
  });
  const backLabel = BACK_TARGETS[openedFrom];
  const goBack = () => router.push(`/dashboard#${openedFrom}`);

  const formatPhone = (phone) => {
    if (!phone) return "";
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) return phone;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const formatDate = (date) => {
    if (!date) return "";
    if (date?.seconds) return new Date(date.seconds * 1000).toISOString().split("T")[0];
    return date;
  };

  const ownerLabel = (ownerId) => {
    if (ownerId === uid) return "You";
    const u = users.find(u => u.id === ownerId);
    if (!u) return "Teammate";
    return u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email;
  };

  const loadProject = async (currentUid, currentRole) => {
    const snap = await getDoc(doc(db, "customers", projectId));
    if (!snap.exists()) {
      setNotFound(true);
      return;
    }
    const data = { id: snap.id, ...snap.data() };
    if (isTrashed(data)) {
      setNotFound("trash");
      return;
    }
    setCustomer(data);

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

    const drawingsSnap = await getDoc(doc(db, "customers", projectId, "drawings", "data"));
    setDrawingsData(drawingsSnap.exists() ? drawingsSnap.data() : { files: [] });

    // Projects converted before bid history was saved on the project: show
    // the pipeline entry they came from instead.
    if (!data.bidHistory) {
      try {
        const legacySnap = await getDocs(query(collection(db, "pipeline"), where("convertedToProjectId", "==", projectId)));
        setLegacyBid(legacySnap.empty ? null : { id: legacySnap.docs[0].id, pipelineId: legacySnap.docs[0].id, ...legacySnap.docs[0].data() });
      } catch {
        setLegacyBid(null);
      }
    }

    const isOwner = data.ownerId === currentUid;
    const isCollaborator = (data.collaboratorIds || []).includes(currentUid);

    if (isOwner || isCollaborator || currentRole === "admin") {
      try {
        const noteSnap = await getDoc(doc(db, "customers", projectId, "private", "data"));
        const notes = noteSnap.exists() ? noteSnap.data() : { notes: "", notesHistory: [] };
        setNotesData(notes);
        setModalNotes(notes.notes || "");
      } catch {
        setNotesData(null);
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
        await loadProject(user.uid, profile.role || "member");
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading this project.");
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const isOwner = customer && customer.ownerId === uid;
  const isCollaborator = customer && (customer.collaboratorIds || []).includes(uid);
  const canSeeNotes = isOwner || isCollaborator || role === "admin";
  const canEditNotes = isOwner || isCollaborator;

  const startEdit = () => {
    setEditData({
      projectName: customer.projectName || "",
      company: customer.company || "",
      companyCategory: firmTypeOf(customer.companyCategory),
      contact: customer.contact || "",
      email: customer.email || "",
      phone: customer.phone || "",
      category: customer.category || "",
      projectValue: customer.projectValue || "",
      workType: customer.workType || "",
      buildingSector: customer.buildingSector || "",
      nextCheckIn: formatDate(customer.nextCheckIn),
      lastContact: formatDate(customer.lastContact),
      projectAddress: customer.projectAddress || ""
    });
    setEquipmentRows(equipmentRowsFrom(customer));
    setOwnerRows(customer.owners || []);
    setSplitRows(normalizeSplits(customer.splits));
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditData({});
  };

  const addEquipmentRow = () => {
    setEquipmentRows(prev => [...prev, { ...BLANK_EQUIPMENT_ROW }]);
  };

  const updateEquipmentRow = (index, field, value) => {
    setEquipmentRows(prev => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const removeEquipmentRow = (index) => {
    setEquipmentRows(prev => prev.filter((_, i) => i !== index));
  };

  const saveEdit = async () => {
    const missing = [];
    if (!editData.projectName) missing.push("Project Name");
    if (!editData.buildingSector) missing.push("Building Sector");
    if (!editData.workType) missing.push("Work Type");
    if (!editData.contact) missing.push("Contact");
    if (!editData.projectAddress) missing.push("Project Address");
    if (missing.length) {
      return alert(`Please fill in the following required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
    }
    const splitProblem = splitError(splitRows);
    if (splitProblem) {
      return alert(splitProblem);
    }

    const payload = {};
    EDITABLE_FIELDS.forEach(f => {
      payload[f] = editData[f] || null;
    });

    const equipment = equipmentRows.filter(r => r.type || r.manufacturer || r.model || r.serial || r.yearInstalled);
    const first = equipment[0] || {};
    payload.equipment = equipment;
    payload.splits = normalizeSplits(splitRows);
    // Everyone on the split works the project, like a collaborator.
    payload.collaboratorIds = withSplitMembers(customer.collaboratorIds, splitRows, customer.ownerId);
    payload.equipmentType = first.type || null;
    payload.towerManufacturer = first.manufacturer || null;
    payload.modelNumber = first.model || null;
    payload.serialNumber = first.serial || null;
    payload.dateInstalled = first.yearInstalled || null;
    const owners = cleanOwnerRows(ownerRows);
    payload.owners = owners;

    // Closing a project schedules a 1-year "how are things going" check-in
    // automatically, so it resurfaces on the Home calendar even though it's
    // now hidden from the active My Projects list.
    if (editData.category === "Project Closed" && customer.category !== "Project Closed") {
      Object.assign(payload, closeProjectPayload(customer.activityLog));
    } else if (editData.category !== "Project Closed" && customer.category === "Project Closed") {
      payload.closedOutcome = null;
      payload.closedAt = null;
    }

    // Status, outcome, work type or owner changing is worth a line in the
    // project's history; equipment and contact edits are not.
    const changes = stateChanges(customer, payload, "project", ownerLabel);
    if (changes.length) {
      payload.activityLog = withActivity(customer.activityLog, activityEntry({
        type: "changed",
        changes,
        by: uid,
        byName: myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : (auth.currentUser?.email || "Unknown")
      }));
    }

    await updateDoc(doc(db, "customers", projectId), payload);

    await notifyUsers(
      newSplitMembers(customer, payload).filter(id => id !== uid),
      { type: "split_share", message: `You were given a share of "${payload.projectName || customer.projectName || customer.company}"`, link: `/dashboard/project/${projectId}` }
    );

    await ensureCompanyAndContactBatch([
      { companyName: editData.company, category: editData.companyCategory, contactName: editData.contact, email: editData.email, phone: editData.phone },
      ...owners.map(r => ({ companyName: r.company, category: OWNER_CATEGORY, contactName: r.contact, email: r.email, phone: r.phone }))
    ], { companies, contacts, uid });

    await Promise.all(
      equipment
        .filter(row => row.manufacturer || row.model)
        .map(row => ensureTowerModel({ towerModels, manufacturer: row.manufacturer, model: row.model, uid }))
    );

    setIsEditing(false);
    await loadProject(uid, role);
  };

  const saveNotes = async () => {
    const existing = notesData || { notes: "", notesHistory: [] };
    const original = existing.notes || "";
    const changed = original !== modalNotes;
    const myName = myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : (auth.currentUser?.email || "Unknown");

    const ref = doc(db, "customers", projectId, "private", "data");

    const newHistory = changed && original
      ? [
          ...(existing.notesHistory || []),
          {
            text: original,
            date: new Date().toISOString(),
            authorId: existing.notesAuthorId || customer.ownerId,
            authorName: existing.notesAuthorName || myName
          }
        ]
      : existing.notesHistory || [];

    await setDoc(ref, {
      notes: modalNotes,
      notesAuthorId: uid,
      notesAuthorName: myName,
      notesHistory: newHistory
    });

    await loadProject(uid, role);
  };

  // Only the person who wrote a note can remove it, and it's gone for
  // good -- no record of the deletion is kept.
  const deleteHistoryEntry = async (index) => {
    if (!window.confirm("Delete this note? It's gone for good -- no copy is kept.")) return;

    const existing = notesData || { notesHistory: [] };
    const newHistory = (existing.notesHistory || []).filter((_, i) => i !== index);

    await setDoc(doc(db, "customers", projectId, "private", "data"), {
      ...existing,
      notesHistory: newHistory
    });

    await loadProject(uid, role);
  };

  const uploadDrawing = async (fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      return alert("Only PDF files can be uploaded here");
    }

    setUploadingDrawing(true);
    try {
      const path = `customers/${projectId}/${Date.now()}-${file.name}`;
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

      const existing = drawingsData || { files: [] };
      await setDoc(doc(db, "customers", projectId, "drawings", "data"), {
        files: [...(existing.files || []), newFile]
      });

      await loadProject(uid, role);
    } catch (err) {
      alert(err.message || "Upload failed");
    } finally {
      setUploadingDrawing(false);
    }
  };

  const deleteDrawing = async (file) => {
    if (!window.confirm(`Delete "${file.name}"? This can't be undone.`)) return;

    try {
      await deleteObject(ref(storage, file.path));
    } catch {
      // file may already be gone from storage; still clean up the metadata
    }

    const existing = drawingsData || { files: [] };
    await setDoc(doc(db, "customers", projectId, "drawings", "data"), {
      files: (existing.files || []).filter(f => f.path !== file.path)
    });

    await loadProject(uid, role);
  };

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load this project</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={goBack}>Back to {backLabel}</button>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">{notFound === "trash" ? "This project is in the trash" : "Project not found"}</h3>
          <p className="modal-subtitle">
            {notFound === "trash"
              ? "It was deleted. Its owner (or an admin) can revive it from Trash in User Settings within 30 days."
              : "This project may have been deleted."}
          </p>
          <button className="btn btn-secondary" onClick={goBack}>Back to {backLabel}</button>
        </div>
      </div>
    );
  }

  if (!customer || !role) {
    return <div className="dashboard-page">Loading...</div>;
  }

  const displayEquipment = equipmentRowsFrom(customer);
  const hasDisplayEquipment = displayEquipment.some(r => r.type || r.manufacturer || r.model || r.serial || r.yearInstalled);

  // Drawings sit beside the equipment normally, and in the lower row while editing.
  const drawingsSection = (
    <div className="project-section">
      <h4 className="field-label">Drawings (PDF)</h4>

      {(drawingsData?.files || []).length === 0 && (
        <p className="private-note-hint">No drawings uploaded yet.</p>
      )}
      {(drawingsData?.files || []).map((f, i) => (
        <div key={i} className="notes-history-item notes-history-row">
          <div>
            <a className="link-muted" href={f.url} target="_blank" rel="noopener noreferrer">{f.name}</a>
            <div className="notes-history-date">
              {formatBytes(f.size)} · uploaded by {f.uploadedByName} · {f.uploadedAt?.slice(0, 10)}
            </div>
          </div>
          {(isOwner || role === "admin") && (
            <button className="btn btn-danger" onClick={() => deleteDrawing(f)}>Delete</button>
          )}
        </div>
      ))}

      {(isOwner || role === "admin") && (
        <div style={{ marginTop: 12 }}>
          <input
            type="file"
            accept="application/pdf"
            disabled={uploadingDrawing}
            onChange={e => uploadDrawing(e.target.files)}
          />
          {uploadingDrawing && <p className="private-note-hint">Uploading...</p>}
        </div>
      )}
    </div>
  );

  // A closed project's check-in box; first in the details grid.
  const closedCheckInSection = isClosedWithCheckIn(customer) && (
    <div className="project-section">
      <h4 className="field-label">Closed Project Check-In</h4>
      <p>
        <strong>Next check-in:</strong> {customer.nextCheckIn || "—"}
        {isCheckInDue(customer) && <span className="role-badge" style={{ marginLeft: 8 }}>Due</span>}
      </p>
      <p className="private-note-hint" style={{ marginBottom: 10 }}>
        Check in with the customer, then log it with Update to set the next check-in 2 years out, or snooze it.
      </p>
      {(isOwner || role === "admin") ? (
        <ClosedCheckInActions
          project={customer}
          byName={myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : auth.currentUser?.email}
          onDone={() => loadProject(uid, role)}
        />
      ) : (
        <p className="private-note-hint">Only {ownerLabel(customer.ownerId)} can update this check-in.</p>
      )}
    </div>
  );

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Project Details</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={goBack}>← Back to {backLabel}</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <div className="project-section">
          <div className="detail-header">
            <div>
              <div className="detail-title-row">
                <h2 className="modal-title" style={{ margin: 0 }}>{customer.projectName || customer.company}</h2>
                {customer.category && <span className="role-badge">{customer.category}</span>}
              </div>
              <p className="modal-subtitle detail-facts">
                {customer.company && customer.projectName && customer.projectName !== customer.company && <span>{customer.company}</span>}
                <span>Owned by {ownerLabel(customer.ownerId)}</span>
                <span>{customer.buildingSector || "No building sector"}</span>
                <span>{customer.projectAddress || "No address"}</span>
                {customer.projectValue && <span>Value {customer.projectValue}</span>}
                <span>{customer.workType || "No work type"}</span>
                {customer.nextCheckIn && <span>Next check-in {formatDate(customer.nextCheckIn)}</span>}
              </p>
            </div>

            {!isEditing && (isOwner || role === "admin") && (
              <div className="detail-header-actions">
                {isOwner && <button className="btn btn-primary" onClick={startEdit}>Edit</button>}
                <DeleteRecordButton
                  kind="project"
                  id={projectId}
                  name={customer.projectName || customer.company || "Untitled project"}
                  onDeleted={() => router.push("/dashboard")}
                />
              </div>
            )}
            {isEditing && (
              <div className="detail-header-actions">
                <button className="btn btn-primary" onClick={saveEdit}>Save</button>
                <button className="btn btn-secondary" onClick={cancelEdit}>Cancel</button>
              </div>
            )}
          </div>

          {(customer.bidHistory || legacyBid) && !isEditing && (
            <div className="view-tabs" style={{ marginTop: 16, marginBottom: 0 }}>
              <button className={`tab-btn ${activeTab === "details" ? "tab-btn-active" : ""}`} onClick={() => setActiveTab("details")}>Project Details</button>
              <button className={`tab-btn ${activeTab === "bid" ? "tab-btn-active" : ""}`} onClick={() => setActiveTab("bid")}>Bid History</button>
            </div>
          )}
        </div>

        {activeTab === "bid" && (customer.bidHistory || legacyBid) && !isEditing ? (
          <BidHistory
            snapshot={customer.bidHistory || legacyBid}
            isLive={!customer.bidHistory}
            bidFiles={notesData?.bidFiles}
            canSeePrivate={canSeeNotes}
            personLabel={ownerLabel}
          />
        ) : (<>

        {isEditing ? (
          <div className="project-section">
            <label className="field-label" htmlFor="project-detail-name" style={{ marginTop: 0 }}>Project Name</label>
            <input id="project-detail-name" className="field" name="detail-projectName" autoComplete="off" value={editData.projectName} onChange={e => setEditData({ ...editData, projectName: e.target.value })} />

            <div className="form-grid-3">
              <FirmTypeSelect id="project-detail-company-type" value={editData.companyCategory} onChange={v => setEditData({ ...editData, companyCategory: v })} />
              <CompanyContactFields
                idPrefix="project-detail"
                companies={companies}
                contacts={contacts}
                companyLabel={editData.companyCategory}
                companyCategory={editData.companyCategory}
                companyValue={editData.company}
                contactValue={editData.contact}
                emailValue={editData.email}
                phoneValue={editData.phone}
                onCompanyChange={v => setEditData(prev => ({ ...prev, company: v }))}
                onContactChange={v => setEditData(prev => ({ ...prev, contact: v }))}
                onEmailChange={v => setEditData(prev => ({ ...prev, email: v }))}
                onPhoneChange={v => setEditData(prev => ({ ...prev, phone: v }))}
              />
              <BuildingSectorSelect id="project-detail-sector" value={editData.buildingSector} onChange={v => setEditData({ ...editData, buildingSector: v })} />
              <div>
                <label className="field-label" htmlFor="project-detail-category">Category</label>
                <select id="project-detail-category" className="field" value={editData.category} onChange={e => setEditData({ ...editData, category: e.target.value })}>
                  <option value="">Select category...</option>
                  {CATEGORY_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="project-detail-value">Project Value</label>
                <MoneyInput id="project-detail-value" name="detail-projectValue" value={editData.projectValue} onChange={v => setEditData(prev => ({ ...prev, projectValue: v }))} />
              </div>
              <WorkTypeSelect id="project-detail-work-type" value={editData.workType} onChange={v => setEditData(prev => ({ ...prev, workType: v }))} />
            </div>

            <h4 className="field-label" style={{ marginTop: 16 }}>Credit Split</h4>
            <CreditSplitEditor idPrefix="project-detail-split" users={users} value={splitRows} onChange={setSplitRows} ownerId={customer.ownerId} ownerLabel="the project owner" />
            <div className="form-grid-3">
              <div>
                <label className="field-label">Project Address (required)</label>
                <AddressAutocomplete name="detail-projectAddress" value={editData.projectAddress} onChange={v => setEditData({ ...editData, projectAddress: v })} />
              </div>
              <div>
                <label className="field-label" htmlFor="project-detail-next">Next Check-In</label>
                <input id="project-detail-next" className="field" type="date" value={editData.nextCheckIn} onChange={e => setEditData({ ...editData, nextCheckIn: e.target.value })} />
              </div>
              <div>
                <label className="field-label" htmlFor="project-detail-last">Last Contact</label>
                <input id="project-detail-last" className="field" type="date" value={editData.lastContact} onChange={e => setEditData({ ...editData, lastContact: e.target.value })} />
              </div>
            </div>

            <h4 className="field-label" style={{ marginTop: 16 }}>Owners & Building Engineers</h4>
            {ownerRows.map((row, i) => (
              <div key={i} className="bidding-company-row">
                <CompanyContactFields
                  idPrefix={`project-detail-owner-${i}`}
                  companies={companies}
                  contacts={contacts}
                  companyLabel="Owner / Building Engineer"
                  companyCategory={OWNER_CATEGORY}
                  companyValue={row.company}
                  contactValue={row.contact}
                  emailValue={row.email}
                  phoneValue={row.phone}
                  onCompanyChange={v => updateOwnerRow(i, "company", v)}
                  onContactChange={v => updateOwnerRow(i, "contact", v)}
                  onEmailChange={v => updateOwnerRow(i, "email", v)}
                  onPhoneChange={v => updateOwnerRow(i, "phone", v)}
                />
                <button className="btn btn-danger" onClick={() => setOwnerRows(prev => prev.filter((_, idx) => idx !== i))}>Remove</button>
              </div>
            ))}
            <button className="btn btn-secondary" onClick={() => setOwnerRows(prev => [...prev, { ...BLANK_OWNER_ROW }])}>+ Add Owner / Building Engineer</button>

            <h4 className="field-label" style={{ marginTop: 16 }}>Equipment & Site Details</h4>
            {equipmentRows.map((row, i) => (
              <div
                key={i}
                className="equipment-row"
              >
                <select
                  className="field"
                  style={{ marginBottom: 0 }}
                  value={row.type}
                  onChange={e => updateEquipmentRow(i, "type", e.target.value)}
                >
                  <option value="">Type of Equipment...</option>
                  {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  className="field"
                  style={{ marginBottom: 0 }}
                  list={`detail-equipment-manufacturers-${i}`}
                  autoComplete="off"
                  placeholder="Tower Manufacturer"
                  value={row.manufacturer}
                  onChange={e => updateEquipmentRow(i, "manufacturer", e.target.value)}
                />
                <datalist id={`detail-equipment-manufacturers-${i}`}>
                  {PRODUCT_MANUFACTURERS.map(m => <option key={m} value={m} />)}
                </datalist>
                <input
                  className="field"
                  style={{ marginBottom: 0 }}
                  autoComplete="off"
                  placeholder="Model Number"
                  value={row.model}
                  onChange={e => updateEquipmentRow(i, "model", e.target.value)}
                />
                <input
                  className="field"
                  style={{ marginBottom: 0 }}
                  autoComplete="off"
                  placeholder="Serial Number"
                  value={row.serial}
                  onChange={e => updateEquipmentRow(i, "serial", e.target.value)}
                />
                <input
                  className="field"
                  style={{ marginBottom: 0 }}
                  type="number"
                  placeholder="Year Installed"
                  min="1900"
                  max="2100"
                  value={row.yearInstalled}
                  onChange={e => updateEquipmentRow(i, "yearInstalled", e.target.value)}
                />
                <button className="btn btn-danger" onClick={() => removeEquipmentRow(i)}>Remove</button>
              </div>
            ))}
            <button className="btn btn-secondary" onClick={addEquipmentRow}>+ Add Equipment</button>
          </div>
        ) : (
          <div className="detail-grid">
            {closedCheckInSection}

            <div className="project-section">
              <h4 className="field-label">Contact Info</h4>
              <dl className="detail-list">
                <dt>{firmTypeOf(customer.companyCategory)}</dt><dd>{customer.company || "—"}</dd>
                <dt>Contact</dt><dd>{customer.contact || "—"}</dd>
                <dt>Email</dt><dd>{customer.email || "—"}</dd>
                <dt>Phone</dt><dd>{formatPhone(customer.phone) || "—"}</dd>
              </dl>
            </div>

            <div className="project-section">
              <h4 className="field-label">Schedule</h4>
              <dl className="detail-list">
                <dt>Next Check-In</dt><dd>{formatDate(customer.nextCheckIn) || "—"}</dd>
                <dt>Last Contact</dt><dd>{formatDate(customer.lastContact) || "—"}</dd>
                <dt>Sector</dt><dd>{customer.buildingSector || "—"}</dd>
                <dt>Value</dt><dd>{customer.projectValue || "—"}</dd>
                {(customer.sourcePipelineId || legacyBid) && (
                  <>
                    <dt>Came from</dt>
                    <dd>
                      <button
                        type="button"
                        className="link-muted matching-select-link"
                        onClick={() => router.push(`/dashboard/pipeline/${customer.sourcePipelineId || legacyBid.pipelineId}`)}
                      >
                        the pipeline entry it was won from
                      </button>
                    </dd>
                  </>
                )}
                <dt>Credit Split</dt><dd>{normalizeSplits(customer.splits).length ? describeSplit(customer.splits, ownerLabel) : "Not split"}</dd>
                {/* Only when someone filed this for the salesperson it
                    belongs to -- otherwise there's nothing to explain. */}
                {customer.enteredBy && (
                  <>
                    <dt>Entered by</dt><dd>{ownerLabel(customer.enteredBy)}</dd>
                  </>
                )}
                <dt>Work Type</dt><dd>{customer.workType || "—"}</dd>
              </dl>
            </div>

            <div className="project-section">
              <h4 className="field-label">Owners & Building Engineers</h4>
              {(customer.owners || []).length === 0 && (
                <p className="private-note-hint">None added yet.</p>
              )}
              {(customer.owners || []).map((row, i) => {
                const firm = companies.find(c => c.name.toLowerCase() === (row.company || "").toLowerCase());
                return (
                  <div
                    key={i}
                    className="notes-history-item"
                    style={{ cursor: firm ? "pointer" : "default" }}
                    onClick={() => { if (firm) router.push(`/dashboard/directory/company/${firm.id}`); }}
                  >
                    <div><strong>{row.company || "—"}</strong>{row.contact ? ` — ${row.contact}` : ""}</div>
                    <div className="notes-history-date">{[row.email, formatPhone(row.phone)].filter(Boolean).join(" | ")}</div>
                  </div>
                );
              })}
            </div>

            <div className="project-section detail-span-2">
              <h4 className="field-label">Equipment & Site Details</h4>
              {!hasDisplayEquipment ? (
                <p className="private-note-hint">No equipment on file.</p>
              ) : (
                <div className="detail-table">
                  <div className="detail-table-row detail-table-head">
                    <span>Type</span>
                    <span>Manufacturer</span>
                    <span>Model</span>
                    <span>Serial</span>
                    <span>Installed</span>
                  </div>
                  {displayEquipment.map((row, i) => (
                    <div key={i} className="detail-table-row">
                      <span><strong>{row.type || "—"}</strong></span>
                      <span>{row.manufacturer || "—"}</span>
                      <span>{row.model || "—"}</span>
                      <span>{row.serial || "—"}</span>
                      <span>{row.yearInstalled || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {drawingsSection}
          </div>
        )}

        <div className="detail-grid">
          {isEditing && closedCheckInSection}

          {isEditing && drawingsSection}

        <div className="project-section">
          <h4 className="field-label">Activity</h4>
          {(customer.activityLog || []).length === 0 && (
            <p className="private-note-hint">No activity yet.</p>
          )}
          {(customer.activityLog || []).map((a, i) => (
            <div key={i} className="notes-history-item">
              <div>{a.type} — {a.outcome}</div>
              {a.by && <div className="private-note-hint">By {a.by}</div>}
              {a.startDate && <div className="private-note-hint">Estimated start: {a.startDate}</div>}
              {a.nextDueDate && <div className="private-note-hint">Next due: {a.nextDueDate}</div>}
              {a.notes && <div className="private-note-hint">{a.outcome === "Lost" ? "Why: " : ""}{a.notes}</div>}
              {a.lostTo && <div className="private-note-hint">Won by: {a.lostTo}</div>}
              <div className="notes-history-date">{a.timestamp}</div>
            </div>
          ))}
        </div>

        <div className="project-section">
          <h4 className="field-label">Notes</h4>

          {!canSeeNotes && (
            <p className="private-note-hint">🔒 Notes are private to {ownerLabel(customer.ownerId)} and their collaborators.</p>
          )}

          {canSeeNotes && !canEditNotes && (
            <>
              <p>{notesData?.notes || "(no notes yet)"}</p>
              {notesData?.notesAuthorName && (
                <p className="private-note-hint">Last written by {notesData.notesAuthorName}</p>
              )}
            </>
          )}

          {canEditNotes && (
            <>
              {notesData?.notesAuthorName && (
                <p className="private-note-hint">Last written by {notesData.notesAuthorName}</p>
              )}
              <textarea
                className="field"
                name="detail-notes"
                autoComplete="off"
                style={{ width: "100%", height: 100 }}
                value={modalNotes}
                onChange={e => setModalNotes(e.target.value)}
              />
              <button className="btn btn-primary" onClick={saveNotes}>Save Notes</button>
            </>
          )}

          {canSeeNotes && (notesData?.notesHistory || []).length > 0 && (
            <>
              <h4 className="field-label" style={{ marginTop: 16 }}>Notes History</h4>
              {notesData.notesHistory.map((h, i) => (
                <div key={i} className="notes-history-item notes-history-row">
                  <div>
                    <div>{h.text}</div>
                    <div className="notes-history-date">{h.authorName || "Unknown"} · {h.date}</div>
                  </div>
                  {h.authorId === uid && (
                    <button className="btn btn-secondary" onClick={() => deleteHistoryEntry(i)}>Delete</button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        {uid && <ProjectMyReminders projectId={projectId} uid={uid} />}
        </div>

        {uid && (
          <PhotoGallery
            kind="project"
            recordId={projectId}
            uid={uid}
            myName={myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : auth.currentUser?.email}
            canAdd={isOwner || isCollaborator || role === "admin"}
            canManageAll={isOwner || role === "admin"}
            limit={5}
          />
        )}

        </>)}
      </div>
    </div>
  );
}
