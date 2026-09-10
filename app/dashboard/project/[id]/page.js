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
  getDocs
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { ensureCompanyAndContact } from "../../../../lib/directory";
import { ensureTowerModel } from "../../../../lib/towerModels";
import CompanyContactFields from "../../../components/CompanyContactFields";
import AddressAutocomplete from "../../../components/AddressAutocomplete";
import DashboardHeader from "../../../components/DashboardHeader";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const CATEGORY_OPTIONS = ["Pre-Bid", "Bidding", "Prospecting", "Ongoing Project", "Order", "Parts", "Project Closed"];

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
  "projectName", "company", "contact", "email", "phone", "category", "projectValue",
  "nextCheckIn", "lastContact",
  "equipmentType", "towerManufacturer", "modelNumber", "serialNumber", "dateInstalled", "projectAddress"
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

  const loadProject = async (currentUid, currentRole) => {
    const snap = await getDoc(doc(db, "customers", projectId));
    if (!snap.exists()) {
      setNotFound(true);
      return;
    }
    const data = { id: snap.id, ...snap.data() };
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
      contact: customer.contact || "",
      email: customer.email || "",
      phone: customer.phone || "",
      category: customer.category || "",
      projectValue: customer.projectValue || "",
      nextCheckIn: formatDate(customer.nextCheckIn),
      lastContact: formatDate(customer.lastContact),
      equipmentType: customer.equipmentType || "",
      towerManufacturer: customer.towerManufacturer || "",
      modelNumber: customer.modelNumber || "",
      serialNumber: customer.serialNumber || "",
      dateInstalled: customer.dateInstalled || "",
      projectAddress: customer.projectAddress || ""
    });
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditData({});
  };

  const saveEdit = async () => {
    const missing = [];
    if (!editData.projectName) missing.push("Project Name");
    if (!editData.contact) missing.push("Contact");
    if (!editData.projectAddress) missing.push("Project Address");
    if (missing.length) {
      return alert(`Please fill in the following required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
    }

    const payload = {};
    EDITABLE_FIELDS.forEach(f => {
      payload[f] = editData[f] || null;
    });

    // Closing a project schedules a 1-year "how are things going" check-in
    // automatically, so it resurfaces on the Home calendar even though it's
    // now hidden from the active My Dashboard list.
    if (editData.category === "Project Closed" && customer.category !== "Project Closed") {
      const followUp = new Date();
      followUp.setFullYear(followUp.getFullYear() + 1);
      payload.nextCheckIn = adjustWeekend(followUp.toISOString());
    }

    await updateDoc(doc(db, "customers", projectId), payload);

    ensureCompanyAndContact({
      companies, contacts, companyName: editData.company, category: "Contractor",
      contactName: editData.contact, email: editData.email, phone: editData.phone, uid
    });

    ensureTowerModel({ towerModels, manufacturer: editData.towerManufacturer, model: editData.modelNumber, uid });

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

  const deleteHistoryEntry = async (index) => {
    if (!window.confirm("Delete this note entry? This can't be undone.")) return;

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
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Project not found</h3>
          <p className="modal-subtitle">This project may have been deleted.</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (!customer || !role) {
    return <div className="dashboard-page">Loading...</div>;
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Project Details</h1>
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
              <h2 className="modal-title" style={{ marginBottom: 2 }}>{customer.projectName || customer.company}</h2>
              {customer.company && customer.projectName && customer.projectName !== customer.company && (
                <p className="modal-subtitle" style={{ marginBottom: 4 }}>{customer.company}</p>
              )}
              <p className="modal-subtitle">Owned by {ownerLabel(customer.ownerId)}</p>
              {customer.category && <span className="role-badge" style={{ marginTop: 6 }}>{customer.category}</span>}
              {customer.projectValue && <p className="modal-subtitle" style={{ marginTop: 6 }}>Value: {customer.projectValue}</p>}
            </div>

            {isOwner && !isEditing && (
              <button className="btn btn-primary" onClick={startEdit}>Edit</button>
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
            <h4 className="field-label">Project Name</h4>
            <input className="field" name="detail-projectName" autoComplete="off" value={editData.projectName} onChange={e => setEditData({ ...editData, projectName: e.target.value })} />

            <CompanyContactFields
              idPrefix="project-detail"
              companies={companies}
              contacts={contacts}
              companyLabel="Contractor"
              companyCategory="Contractor"
              companyValue={editData.company}
              contactValue={editData.contact}
              emailValue={editData.email}
              phoneValue={editData.phone}
              onCompanyChange={v => setEditData({ ...editData, company: v })}
              onContactChange={v => setEditData({ ...editData, contact: v })}
              onEmailChange={v => setEditData({ ...editData, email: v })}
              onPhoneChange={v => setEditData({ ...editData, phone: v })}
            />

            <h4 className="field-label">Category</h4>
            <select className="field" value={editData.category} onChange={e => setEditData({ ...editData, category: e.target.value })}>
              <option value="">Select category...</option>
              {CATEGORY_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>

            <h4 className="field-label">Project Value</h4>
            <input className="field" name="detail-projectValue" autoComplete="off" value={editData.projectValue} onChange={e => setEditData({ ...editData, projectValue: e.target.value })} />

            <h4 className="field-label">Project Address (required)</h4>
            <AddressAutocomplete name="detail-projectAddress" value={editData.projectAddress} onChange={v => setEditData({ ...editData, projectAddress: v })} />

            <h4 className="field-label">Next Check-In</h4>
            <input className="field" type="date" value={editData.nextCheckIn} onChange={e => setEditData({ ...editData, nextCheckIn: e.target.value })} />

            <h4 className="field-label">Last Contact</h4>
            <input className="field" type="date" value={editData.lastContact} onChange={e => setEditData({ ...editData, lastContact: e.target.value })} />

            <h4 className="field-label" style={{ marginTop: 16 }}>Equipment & Site Details</h4>

            <h4 className="field-label">Type of Equipment</h4>
            <input className="field" name="detail-equipmentType" autoComplete="off" value={editData.equipmentType} onChange={e => setEditData({ ...editData, equipmentType: e.target.value })} />

            <h4 className="field-label">Tower Manufacturer</h4>
            <input className="field" name="detail-towerManufacturer" autoComplete="off" value={editData.towerManufacturer} onChange={e => setEditData({ ...editData, towerManufacturer: e.target.value })} />

            <h4 className="field-label">Model Number</h4>
            <input className="field" name="detail-modelNumber" autoComplete="off" value={editData.modelNumber} onChange={e => setEditData({ ...editData, modelNumber: e.target.value })} />

            <h4 className="field-label">Serial Number</h4>
            <input className="field" name="detail-serialNumber" autoComplete="off" value={editData.serialNumber} onChange={e => setEditData({ ...editData, serialNumber: e.target.value })} />

            <h4 className="field-label">Year Installed</h4>
            <input className="field" type="number" placeholder="YYYY" min="1900" max="2100" value={editData.dateInstalled} onChange={e => setEditData({ ...editData, dateInstalled: e.target.value })} />
          </div>
        ) : (
          <>
            <div className="project-section">
              <h4 className="field-label">Contact Info</h4>
              <p><strong>Contact:</strong> {customer.contact || "—"}</p>
              <p><strong>Email:</strong> {customer.email || "—"}</p>
              <p><strong>Phone:</strong> {formatPhone(customer.phone) || "—"}</p>
            </div>

            <div className="project-section">
              <h4 className="field-label">Schedule</h4>
              <p><strong>Project Address:</strong> {customer.projectAddress || "—"}</p>
              <p><strong>Next Check-In:</strong> {formatDate(customer.nextCheckIn) || "—"}</p>
              <p><strong>Last Contact:</strong> {formatDate(customer.lastContact) || "—"}</p>
            </div>

            <div className="project-section">
              <h4 className="field-label">Equipment & Site Details</h4>
              <p><strong>Type of Equipment:</strong> {customer.equipmentType || "—"}</p>
              <p><strong>Tower Manufacturer:</strong> {customer.towerManufacturer || "—"}</p>
              <p><strong>Model Number:</strong> {customer.modelNumber || "—"}</p>
              <p><strong>Serial Number:</strong> {customer.serialNumber || "—"}</p>
              <p><strong>Year Installed:</strong> {customer.dateInstalled || "—"}</p>
            </div>
          </>
        )}

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

        <div className="project-section">
          <h4 className="field-label">Activity</h4>
          {(customer.activityLog || []).length === 0 && (
            <p className="private-note-hint">No activity yet.</p>
          )}
          {(customer.activityLog || []).map((a, i) => (
            <div key={i} className="notes-history-item">
              <div>{a.type} via {a.method}</div>
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
                  {canEditNotes && (
                    <button className="btn btn-danger" onClick={() => deleteHistoryEntry(i)}>Delete</button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
