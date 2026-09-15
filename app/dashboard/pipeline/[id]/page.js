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
import WorkTypeSelect from "../../../components/WorkTypeSelect";
import BidderEditor from "../../../components/BidderEditor";
import { bidderRowsForEditing, biddersForStorage, bidderDirectoryEntries, bidderMissingSalesperson, groupBidders, contactsOf } from "../../../../lib/bidders";
import { buildBidSnapshot } from "../../../../lib/bidHistory";
import PipelineMyAlerts from "../../../components/PipelineMyAlerts";
import DeleteRecordButton from "../../../components/DeleteRecordButton";
import { ensureTowerModel } from "../../../../lib/towerModels";
import ProductOptionsEditor from "../../../components/ProductOptionsEditor";
import { blankProductRow, productRowsFrom, productRowsForStorage, isTowerRow } from "../../../../lib/equipment";
import CompanyContactFields from "../../../components/CompanyContactFields";
import AddressAutocomplete from "../../../components/AddressAutocomplete";
import DashboardHeader from "../../../components/DashboardHeader";
import MobileNav from "../../../components/MobileNav";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const PIPELINE_STAGE_OPTIONS = ["Pre-Bid", "Bidding", "Post-Bid", "Design", "Budgeting"];

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

const EDITABLE_FIELDS = ["title", "buildingSector", "stage", "bidDate", "value", "workType", "company", "contact", "email", "phone", "projectAddress", "salespersonId", "projectPointPersonId"];

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
  const [products, setProducts] = useState([]);
  const [privateData, setPrivateData] = useState(null);
  const [modalNotes, setModalNotes] = useState("");

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [biddingRows, setBiddingRows] = useState([]);
  const [productRows, setProductRows] = useState([]);

  const [uploading, setUploading] = useState(false);

  const [showConvertModal, setShowConvertModal] = useState(false);
  const [showWonModal, setShowWonModal] = useState(false);
  const [wonContractor, setWonContractor] = useState("");
  // "Lost" or "Did Not Bid" while that form is open; both record why and
  // who won, and both end the entry with no follow-up.
  const [lostModalOutcome, setLostModalOutcome] = useState(null);
  const [lostReason, setLostReason] = useState("");
  const [lostTo, setLostTo] = useState("");
  const [convertNextDate, setConvertNextDate] = useState("");
  const [convertProjectAddress, setConvertProjectAddress] = useState("");
  const [convertData, setConvertData] = useState({});
  const [converting, setConverting] = useState(false);

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

    const [usersSnap, companiesSnap, contactsSnap, towerModelsSnap, productsSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "companies")),
      getDocs(collection(db, "contacts")),
      getDocs(collection(db, "towerModels")),
      getDocs(collection(db, "products"))
    ]);
    setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setTowerModels(towerModelsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setProducts(productsSnap.docs.map(d => ({ id: d.id, ...d.data() })));

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
      workType: pipeline.workType || "",
      bidDate: pipeline.bidDate || "",
      value: pipeline.value || "",
      company: pipeline.company || "",
      contact: pipeline.contact || "",
      email: pipeline.email || "",
      phone: pipeline.phone || "",
      projectAddress: pipeline.projectAddress || "",
      salespersonId: pipeline.salespersonId || "",
      projectPointPersonId: pipeline.projectPointPersonId || ""
    });
    setBiddingRows(bidderRowsForEditing(pipeline.biddingCompanies));
    const rows = productRowsFrom(pipeline);
    setProductRows(rows.length ? rows : [blankProductRow()]);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditData({});
    setBiddingRows([]);
    setProductRows([]);
  };

  const saveEdit = async () => {
    if (!editData.title) {
      return alert("Project/opportunity name is required");
    }
    if (!editData.buildingSector) {
      return alert("Please select a building sector");
    }
    if (!editData.workType) {
      return alert("Please select a work type (new installation, replacement, or repair)");
    }
    // Every bidder needs one of our salespeople assigned to it.
    const missingSalesperson = bidderMissingSalesperson(biddingRows);
    if (missingSalesperson) {
      return alert(`Select a salesperson for bidder "${missingSalesperson.company || "without a firm name"}"`);
    }

    const payload = {};
    EDITABLE_FIELDS.forEach(f => {
      payload[f] = editData[f] || null;
    });
    // One row per firm, with all of that firm's people grouped under it.
    payload.biddingCompanies = biddersForStorage(biddingRows);
    // Products quoted; not installed yet, so never a serial number. The
    // first row is mirrored into the older single-product fields.
    payload.equipment = productRowsForStorage(productRows);
    payload.towerManufacturer = payload.equipment[0]?.manufacturer || null;
    payload.modelNumber = payload.equipment[0]?.model || null;
    payload.serialNumber = null;

    await updateDoc(doc(db, "pipeline", pipelineId), payload);

    const captureEntries = [
      { companyName: editData.company, category: "Engineering Firm", contactName: editData.contact, email: editData.email, phone: editData.phone },
      ...bidderDirectoryEntries(payload.biddingCompanies, firmTypeOf)
    ];
    await ensureCompanyAndContactBatch(captureEntries, { companies, contacts, uid });
    await Promise.all(
      payload.equipment.filter(isTowerRow).map(row => ensureTowerModel({ towerModels, manufacturer: row.manufacturer, model: row.model, uid }))
    );

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

  // Lets anyone track a pipeline entry on their own My Projects without
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
    if (!lostReason.trim()) {
      return alert(lostModalOutcome === "Did Not Bid" ? "Enter why we aren't bidding" : "Enter why this was lost");
    }
    await updateDoc(doc(db, "pipeline", pipelineId), {
      outcome: lostModalOutcome,
      wonByContractor: null,
      lostReason: lostReason.trim(),
      lostTo: lostTo.trim() || null,
      resolvedAt: new Date().toISOString(),
      nextCheckIn: null
    });
    setLostModalOutcome(null);
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

  // Only offered once an entry is marked Won. Pre-fills from the bid: the
  // entry's salesperson (or owner) and the winning firm, matched back to a
  // bidding row so its contact info and firm type carry over.
  const openConvert = () => {
    const winner = groupBidders(pipeline.biddingCompanies).find(
      b => (b.company || "").toLowerCase() === (pipeline.wonByContractor || "").toLowerCase()
    );
    const winnerContact = contactsOf(winner)[0] || {};
    setConvertData({
      salespersonId: pipeline.salespersonId || pipeline.ownerId || "",
      companyCategory: firmTypeOf(winner?.category),
      company: winner?.company || pipeline.wonByContractor || "",
      contact: winnerContact.name || "",
      email: winnerContact.email || "",
      phone: winnerContact.phone || "",
      buildingSector: pipeline.buildingSector || "",
      workType: pipeline.workType || ""
    });
    setConvertProjectAddress(pipeline.projectAddress || "");
    setConvertNextDate("");
    setShowConvertModal(true);
  };

  const convertToProject = async () => {
    const missing = [];
    if (!convertData.salespersonId) missing.push("Salesperson");
    if (!convertData.company?.trim()) missing.push(convertData.companyCategory || "Contractor");
    if (!convertData.buildingSector) missing.push("Building Sector");
    if (!convertData.workType) missing.push("Work Type");
    if (!convertNextDate) missing.push("Next Check-In Date");
    if (!convertProjectAddress) missing.push("Project Address");
    if (missing.length) {
      return alert(`Please fill in: ${missing.join(", ")}`);
    }

    setConverting(true);
    try {
      const now = new Date().toISOString();
      const myName = myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : (auth.currentUser?.email || "Unknown");
      // Serial numbers and install years get filled in on the project once
      // the equipment is actually installed.
      const equipment = productRowsFrom(pipeline).map(e => ({ ...e, serial: "", yearInstalled: "" }));
      const first = equipment[0] || {};

      const ref3 = await addDoc(collection(db, "customers"), {
        projectName: pipeline.title,
        company: convertData.company.trim(),
        companyCategory: convertData.companyCategory,
        contact: convertData.contact || "",
        email: convertData.email || "",
        phone: convertData.phone || "",
        owners: [],
        category: "Ongoing Project",
        buildingSector: convertData.buildingSector,
        projectValue: pipeline.value || null,
        workType: convertData.workType,
        projectAddress: convertProjectAddress,
        equipment,
        towerManufacturer: first.manufacturer || pipeline.towerManufacturer || null,
        modelNumber: first.model || pipeline.modelNumber || null,
        serialNumber: null,
        nextCheckIn: adjustWeekend(convertNextDate + "T12:00:00"),
        lastContact: now.split("T")[0],
        activityLog: [{ type: "converted", outcome: "From won pipeline entry", notes: `Converted by ${myName}`, timestamp: now }],
        ownerId: convertData.salespersonId,
        collaboratorIds: [],
        projectPointPersonId: pipeline.projectPointPersonId || null,
        sourcePipelineId: pipeline.id,
        bidHistory: buildBidSnapshot(pipeline),
        createdAt: now
      });

      await setDoc(doc(db, "customers", ref3.id, "private", "data"), {
        notes: privateData?.notes || "",
        notesHistory: privateData?.notesHistory || [],
        bidFiles: privateData?.files || []
      });

      await ensureCompanyAndContactBatch([
        { companyName: convertData.company, category: convertData.companyCategory, contactName: convertData.contact, email: convertData.email, phone: convertData.phone }
      ], { companies, contacts, uid });

      // The project now carries the follow-up, so the pipeline entry's own
      // 1-year Won check-in is cleared to avoid a duplicate reminder.
      await updateDoc(doc(db, "pipeline", pipelineId), {
        convertedToProjectId: ref3.id,
        convertedAt: now,
        nextCheckIn: null
      });

      router.push(`/dashboard/project/${ref3.id}`);
    } catch (err) {
      alert(`Couldn't create the project: ${err.message}`);
      setConverting(false);
    }
  };

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load this entry</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#pipeline")}>Back to Pipeline</button>
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
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#pipeline")}>Back to Pipeline</button>
        </div>
      </div>
    );
  }

  if (!pipeline || !role) {
    return <div className="dashboard-page">Loading...</div>;
  }

  // Shown with the details normally, and in the lower row while editing.
  const outcomeSection = (
    <div className="project-section">
      <h4 className="field-label">Outcome</h4>
      {!pipeline.outcome && (
        <>
          <p className="private-note-hint">Still in progress.</p>
          {canEdit && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => setShowWonModal(true)}>Mark Won</button>
              <button className="btn btn-danger" onClick={() => setLostModalOutcome("Lost")}>Mark Lost</button>
              <button className="btn btn-secondary" onClick={() => setLostModalOutcome("Did Not Bid")}>Not Bidding</button>
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
          {pipeline.convertedToProjectId ? (
            <p>
              ✅ Converted to a project —{" "}
              <a className="link-muted" href={`/dashboard/project/${pipeline.convertedToProjectId}`}>View project</a>
            </p>
          ) : (
            <p className="private-note-hint">Next step: convert this into a project so it's tracked on a salesperson's dashboard.</p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!pipeline.convertedToProjectId && (isOwner || role === "admin") && (
              <button className="btn btn-primary" onClick={openConvert}>Convert to Project</button>
            )}
            {canEdit && !pipeline.convertedToProjectId && <button className="btn btn-secondary" onClick={reopenPipeline}>Reopen</button>}
          </div>
        </>
      )}
      {(pipeline.outcome === "Lost" || pipeline.outcome === "Did Not Bid") && (
        <>
          <p>
            {pipeline.outcome === "Lost" ? "❌ " : "🚫 "}
            <strong>{pipeline.outcome === "Lost" ? "Lost" : "Did Not Bid"}</strong>
            {pipeline.resolvedAt ? ` on ${pipeline.resolvedAt.slice(0, 10)}` : ""}
          </p>
          <p><strong>Why:</strong> {pipeline.lostReason || "No reason recorded"}</p>
          <p><strong>Won by:</strong> {pipeline.lostTo || "Not recorded"}</p>
          {canEdit && <button className="btn btn-secondary" onClick={reopenPipeline}>Reopen</button>}
        </>
      )}
    </div>
  );

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Pipeline Entry</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#pipeline")}>← Back to Pipeline</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <div className="project-section">
          <div className="detail-header">
            <div>
              <div className="detail-title-row">
                <h2 className="modal-title" style={{ margin: 0 }}>{pipeline.title}</h2>
                <span className="role-badge role-badge-admin">{pipeline.stage}</span>
              </div>
              <p className="modal-subtitle detail-facts">
                <span>Owned by {ownerLabel(pipeline.ownerId)}</span>
                <span>{pipeline.buildingSector || "No building sector"}</span>
                <span>{pipeline.projectAddress || "No address"}</span>
                {pipeline.bidDate && <span>Bid {pipeline.bidDate}</span>}
                {pipeline.value && <span>Value {pipeline.value}</span>}
                <span>{pipeline.workType || "No work type"}</span>
                {pipeline.convertedToProjectId && (
                  <span>
                    ✅ Converted —{" "}
                    <a className="link-muted" href={`/dashboard/project/${pipeline.convertedToProjectId}`}>View project</a>
                  </span>
                )}
              </p>
            </div>

            {canEdit && !isEditing && (
              <div className="detail-header-actions">
                <button className="btn btn-secondary" onClick={toggleTracked}>
                  {isTracked ? "Remove From My Projects" : "Add To My Projects"}
                </button>
                <button className="btn btn-primary" onClick={startEdit}>Edit</button>
                {canDelete && (
                  <DeleteRecordButton
                    kind="pipeline"
                    id={pipelineId}
                    name={pipeline.title || "Untitled pipeline entry"}
                    onDeleted={() => router.push("/dashboard#pipeline")}
                  />
                )}
              </div>
            )}
            {isEditing && (
              <div className="detail-header-actions">
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
              <WorkTypeSelect id="pipeline-detail-work-type" value={editData.workType} onChange={v => setEditData({ ...editData, workType: v })} />
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

              <div>
                <label className="field-label">Project Address</label>
                <AddressAutocomplete name="pipeline-detail-projectAddress" value={editData.projectAddress} onChange={v => setEditData({ ...editData, projectAddress: v })} />
              </div>
            </div>

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

            <h4 className="field-label" style={{ marginTop: 16 }}>Contractors & Owners Bidding</h4>
            <BidderEditor
              idPrefix="pipeline-detail-bidder"
              bidders={biddingRows}
              onChange={setBiddingRows}
              companies={companies}
              contacts={contacts}
              users={users}
            />

            <h4 className="field-label" style={{ marginTop: 16 }}>Product Options</h4>
            <ProductOptionsEditor idPrefix="pipeline-detail-product" rows={productRows} onChange={setProductRows} products={products} />
          </div>
        ) : (
          <>
            <div className="detail-grid">
              <div className="project-section">
                <h4 className="field-label">Bid & Team</h4>
                <dl className="detail-list">
                  <dt>Bid Date</dt><dd>{pipeline.bidDate || "—"}</dd>
                  <dt>Est. Value</dt><dd>{pipeline.value || "—"}</dd>
                  <dt>Work Type</dt><dd>{pipeline.workType || "—"}</dd>
                  <dt>Sector</dt><dd>{pipeline.buildingSector || "—"}</dd>
                  <dt>Salesperson</dt><dd>{pipeline.salespersonId ? ownerLabel(pipeline.salespersonId) : "Unassigned"}</dd>
                  <dt>Point Person</dt><dd>{pipeline.projectPointPersonId ? ownerLabel(pipeline.projectPointPersonId) : "Unassigned"}</dd>
                </dl>
              </div>

              <div className="project-section">
                <h4 className="field-label">Engineering Firm</h4>
                <dl className="detail-list">
                  <dt>Firm</dt><dd>{pipeline.company || "—"}</dd>
                  <dt>Contact</dt><dd>{pipeline.contact || "—"}</dd>
                  <dt>Email</dt><dd>{pipeline.email || "—"}</dd>
                  <dt>Phone</dt><dd>{formatPhone(pipeline.phone) || "—"}</dd>
                </dl>
              </div>

              {outcomeSection}

              <div className="project-section detail-span-2">
                <h4 className="field-label">Contractors & Owners Bidding</h4>
                {(pipeline.biddingCompanies || []).length === 0 && (
                  <p className="private-note-hint">None added yet.</p>
                )}
                {groupBidders(pipeline.biddingCompanies).length > 0 && (
                  <div className="bidder-list">
                    <div className="bidder-list-row bidder-list-head">
                      <span>Firm</span>
                      <span>Salesperson</span>
                      <span>People</span>
                    </div>
                    {groupBidders(pipeline.biddingCompanies).map((row, i) => (
                      <div key={i} className="bidder-list-row">
                        <div>
                          <strong>{row.company || "Unnamed firm"}</strong>
                          <div className="notes-history-date">{firmTypeOf(row.category)}</div>
                        </div>
                        <div>{row.salespersonId ? ownerLabel(row.salespersonId) : "Not assigned"}</div>
                        <div>
                          {contactsOf(row).length === 0 ? (
                            <span className="notes-history-date">No people added</span>
                          ) : (
                            contactsOf(row).map((c, ci) => (
                              <div key={ci} className="bidder-list-person">
                                <span>{c.name || "Unnamed contact"}</span>
                                {(c.email || c.phone) && (
                                  <span className="notes-history-date"> — {[c.email, formatPhone(c.phone)].filter(Boolean).join(" | ")}</span>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="project-section">
                <h4 className="field-label">Product Options</h4>
                {productRowsFrom(pipeline).length === 0 ? (
                  <p className="private-note-hint">None added yet.</p>
                ) : (
                  productRowsFrom(pipeline).map((row, i) => (
                    <p key={i}>
                      <strong>{row.type || "Product"}:</strong> {[row.manufacturer, row.model].filter(Boolean).join(" — ") || "—"}
                    </p>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        <div className="detail-grid">
          {isEditing && outcomeSection}

          {!pipeline.outcome && !pipeline.convertedToProjectId && uid && (
            <PipelineMyAlerts pipeline={pipeline} uid={uid} />
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

      {lostModalOutcome && (
        <div className="modal-overlay">
          <div className="modal-card">
            <button className="modal-close" onClick={() => setLostModalOutcome(null)}>✕</button>
            <h3 className="modal-title">{lostModalOutcome === "Did Not Bid" ? "Not Bidding" : "Mark as Lost"}</h3>
            <p className="modal-subtitle">
              {lostModalOutcome === "Did Not Bid"
                ? "Moves this to Past Projects filed as Did Not Bid, with no reminders."
                : "This shows in Past Projects so the team can see what happened."}
            </p>

            <label className="field-label" htmlFor="pipeline-lost-reason">
              {lostModalOutcome === "Did Not Bid" ? "Why aren't we bidding?" : "Why was it lost?"}
            </label>
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
              <button className="btn btn-danger" onClick={confirmMarkLost}>
                {lostModalOutcome === "Did Not Bid" ? "Mark Did Not Bid" : "Mark Lost"}
              </button>
              <button className="btn btn-secondary" onClick={() => setLostModalOutcome(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showConvertModal && (
        <div className="modal-overlay">
          <div className="modal-card modal-wide">
            <button className="modal-close" onClick={() => setShowConvertModal(false)}>✕</button>
            <h3 className="modal-title">Convert to Project</h3>
            <p className="modal-subtitle" style={{ marginBottom: 12 }}>
              Creates an Ongoing Project from "{pipeline.title}" on the salesperson's dashboard. All of the bid
              details, bidders, notes, and files are kept on the project's Bid History tab.
            </p>

            <div className="form-grid-2">
              <div>
                <label className="field-label" htmlFor="convert-salesperson">Salesperson (project owner)</label>
                <select id="convert-salesperson" className="field" value={convertData.salespersonId} onChange={e => setConvertData({ ...convertData, salespersonId: e.target.value })}>
                  <option value="">Select salesperson...</option>
                  {users.filter(u => !u.disabled).map(u => (
                    <option key={u.id} value={u.id}>{u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email}</option>
                  ))}
                </select>
              </div>
              <BuildingSectorSelect id="convert-sector" value={convertData.buildingSector} onChange={v => setConvertData({ ...convertData, buildingSector: v })} />
              <WorkTypeSelect id="convert-work-type" value={convertData.workType} onChange={v => setConvertData({ ...convertData, workType: v })} />

              <FirmTypeSelect id="convert-firm-type" value={convertData.companyCategory || "Contractor"} onChange={v => setConvertData({ ...convertData, companyCategory: v })} />
              <div />
              <CompanyContactFields
                idPrefix="convert"
                companies={companies}
                contacts={contacts}
                companyLabel={convertData.companyCategory || "Contractor"}
                companyCategory={convertData.companyCategory || "Contractor"}
                companyValue={convertData.company || ""}
                contactValue={convertData.contact || ""}
                emailValue={convertData.email || ""}
                phoneValue={convertData.phone || ""}
                onCompanyChange={v => setConvertData(prev => ({ ...prev, company: v }))}
                onContactChange={v => setConvertData(prev => ({ ...prev, contact: v }))}
                onEmailChange={v => setConvertData(prev => ({ ...prev, email: v }))}
                onPhoneChange={v => setConvertData(prev => ({ ...prev, phone: v }))}
              />

              <div>
                <label className="field-label" htmlFor="convert-next-date">Next Check-In Date</label>
                <input id="convert-next-date" className="field" type="date" value={convertNextDate} onChange={e => setConvertNextDate(e.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor="convert-address">Project Address</label>
                <AddressAutocomplete id="convert-address" name="convert-projectAddress" value={convertProjectAddress} onChange={setConvertProjectAddress} />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" disabled={converting} onClick={convertToProject}>{converting ? "Creating…" : "Create Project"}</button>
              <button className="btn btn-secondary" onClick={() => setShowConvertModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
