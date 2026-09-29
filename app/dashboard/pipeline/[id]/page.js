"use client";

import { useEffect, useRef, useState } from "react";
import { withDollar } from "../../../../lib/analytics";
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
import { ensureCompanyAndContactBatch, firmTypeOf, salespersonAfterFirmChange } from "../../../../lib/directory";
import { notifyUsers, firmOwnersFor, newlyAddedFirms, newSplitMembers } from "../../../../lib/notify";
import { stateChanges, activityEntry, withActivity } from "../../../../lib/activityLog";
import { movedToPostBid, postBidCheckIn, POST_BID } from "../../../../lib/pipelineStages";
import BuildingSectorSelect from "../../../components/BuildingSectorSelect";
import WorkTypeSelect from "../../../components/WorkTypeSelect";
import { LeadTimeFields, LeadTimeSummary, LeadTimeInput } from "../../../components/LeadTimeFields";
import BidderEditor from "../../../components/BidderEditor";
import { bidderRowsForEditing, biddersForStorage, bidderDirectoryEntries, bidderMissingSalesperson, groupBidders, contactsOf, bidderExportRows, BIDDER_EXPORT_HEADERS } from "../../../../lib/bidders";
import { buildBidSnapshot } from "../../../../lib/bidHistory";
import PipelineMyAlerts from "../../../components/PipelineMyAlerts";
import PipelineNotes from "../../../components/PipelineNotes";
import useUnsavedGuard from "../../../components/useUnsavedGuard";
import DeleteRecordButton from "../../../components/DeleteRecordButton";
import { ensureTowerModel } from "../../../../lib/towerModels";
import ProductOptionsEditor from "../../../components/ProductOptionsEditor";
import { blankProductRow, productRowsFrom, productRowsForStorage, isTowerRow } from "../../../../lib/equipment";
import CompanyContactFields from "../../../components/CompanyContactFields";
import AddressAutocomplete from "../../../components/AddressAutocomplete";
import DashboardHeader from "../../../components/DashboardHeader";
import MoneyInput from "../../../components/MoneyInput";
import MobileNav from "../../../components/MobileNav";
import { isTrashed } from "../../../../lib/trash";
import PhotoGallery from "../../../components/PhotoGallery";
import { FirmSelect } from "../../../components/DirectoryPickers";
import { sameCompany } from "../../../../lib/companyMatch";
import CreditSplitEditor from "../../../components/CreditSplitEditor";
import { describeSplit, normalizeSplits, splitError, withSplitMembers } from "../../../../lib/splits";
import Icon from "../../../components/Icon";
import ConfirmDialog from "../../../components/ConfirmDialog";
import ExportButtons from "../../../components/ExportButtons";
import { downloadTable, csvDateStamp } from "../../../../lib/csv";
import { DID_NOT_BID_REASONS, OTHER, didNotBidReason, didNotBidProblem } from "../../../../lib/notBidding";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const PIPELINE_STAGE_OPTIONS = ["Pre-Bid", "Bidding", "Post-Bid", "Design", "Budgeting"];

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

const EDITABLE_FIELDS = ["title", "buildingSector", "stage", "bidDate", "value", "workType", "company", "contact", "email", "phone", "projectAddress", "salespersonId", "projectPointPersonId",
  // Equipment lead time and the dates it runs on.
  "leadTime", "leadTimeAlerts", "orderedOn", "shippedOn", "deliveredOn"];

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
  // Jobs already on file, so the product rows can offer the maker this
  // company actually uses for a given type.
  const [pastProjects, setPastProjects] = useState([]);
  const [privateData, setPrivateData] = useState(null);

  const [isEditing, setIsEditing] = useState(false);
  // Closing the tab mid-edit shouldn't lose what's typed.
  useUnsavedGuard(isEditing);
  const [editData, setEditData] = useState({});
  const [biddingRows, setBiddingRows] = useState([]);
  const [splitRows, setSplitRows] = useState([]);
  const [productRows, setProductRows] = useState([]);

  const [uploading, setUploading] = useState(false);
  const [ask, setAsk] = useState(null);
  const [editProblem, setEditProblem] = useState("");
  const [fileProblem, setFileProblem] = useState("");
  const [bidsSentProblem, setBidsSentProblem] = useState("");
  const [wonProblem, setWonProblem] = useState("");
  const [lostProblem, setLostProblem] = useState("");
  const [convertProblem, setConvertProblem] = useState("");

  const [showConvertModal, setShowConvertModal] = useState(false);
  const [showWonModal, setShowWonModal] = useState(false);
  // Bids Sent: the step between sending a number and hearing anything.
  const [showBidsSentModal, setShowBidsSentModal] = useState(false);
  const [bidsSentDate, setBidsSentDate] = useState("");
  // Filled on the Won modal when the entry has no lead time yet.
  const [wonLeadTime, setWonLeadTime] = useState("");
  const [wonOrderedOn, setWonOrderedOn] = useState("");
  const [wonContractor, setWonContractor] = useState("");
  // "Lost" or "Did Not Bid" while that form is open; both record why and
  // who won, and both end the entry with no follow-up.
  const [lostModalOutcome, setLostModalOutcome] = useState(null);
  const [lostReason, setLostReason] = useState("");
  // Which of the standing reasons was picked for Did Not Bid. Kept apart
  // from the text so "Other" can require something written under it.
  const [dnbChoice, setDnbChoice] = useState("");
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
    // Back to the Friday before, so it lands ahead of the weekend.
    if (day === 6) d.setDate(d.getDate() - 1);
    if (day === 0) d.setDate(d.getDate() - 2);
    return d.toISOString().split("T")[0];
  };

  // The bidders list as a spreadsheet: one row per person, since that is
  // what someone chasing a job actually works down.
  const exportBidders = (format) => downloadTable({
    filename: `bidders-${(pipeline.title || "entry").replace(/[^\w-]+/g, "-").toLowerCase()}-${csvDateStamp()}`,
    headers: BIDDER_EXPORT_HEADERS,
    rows: bidderExportRows(pipeline.biddingCompanies, {
      personLabel: ownerLabel,
      wonByContractor: pipeline.wonByContractor,
      firmTypeOf
    }),
    format,
    sheetName: "Bidders"
  });

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
    if (isTrashed(data)) {
      setNotFound("trash");
      return;
    }
    setPipeline(data);

    const [usersSnap, companiesSnap, contactsSnap, towerModelsSnap, productsSnap, pastSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "companies")),
      getDocs(collection(db, "contacts")),
      getDocs(collection(db, "towerModels")),
      getDocs(collection(db, "products")),
      // Only feeds the manufacturer suggestions. If it can't be read the
      // page still works and the picker simply falls back to the standing
      // list, which is what it offered before any of this existed.
      getDocs(collection(db, "customers")).catch(() => null)
    ]);
    setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setTowerModels(towerModelsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setProducts(productsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setPastProjects(pastSnap ? pastSnap.docs.map(d => ({ id: d.id, ...d.data() })) : []);

    const isOwner = data.ownerId === currentUid;

    if (isOwner || currentRole === "admin") {
      try {
        const privSnap = await getDoc(doc(db, "pipeline", pipelineId, "private", "data"));
        const priv = privSnap.exists() ? privSnap.data() : { notes: "", notesHistory: [], files: [] };
        setPrivateData(priv);
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

  // Same as the project page: a link carrying ?edit=1 opens edit mode, so
  // an Edit button on a list behaves exactly like opening the entry and
  // pressing Edit here.
  const askedToEdit = useRef(false);
  useEffect(() => {
    if (askedToEdit.current || !pipeline || isEditing) return;
    const wants = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("edit") === "1";
    if (!wants) return;
    askedToEdit.current = true;
    if (canEdit) startEdit();
    window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline, canEdit, isEditing]);
  const canEditPrivate = isOwner;
  const canDelete = isOwner || role === "admin";

  const startEdit = () => {
    setEditData({
      title: pipeline.title || "",
      stage: pipeline.stage || "Pre-Bid",
      buildingSector: pipeline.buildingSector || "",
      workType: pipeline.workType || "",
      leadTime: pipeline.leadTime || "",
      leadTimeAlerts: pipeline.leadTimeAlerts === true,
      orderedOn: pipeline.orderedOn || "",
      shippedOn: pipeline.shippedOn || "",
      deliveredOn: pipeline.deliveredOn || "",
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
    setSplitRows(normalizeSplits(pipeline.splits));
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
    setEditProblem("");
    if (!editData.title) {
      return setEditProblem("A project/opportunity name is required.");
    }
    if (!editData.buildingSector) {
      return setEditProblem("Select a building sector.");
    }
    if (!editData.workType) {
      return setEditProblem("Select a work type — new installation, replacement, or repair.");
    }
    const splitProblem = splitError(splitRows);
    if (splitProblem) {
      return setEditProblem(splitProblem);
    }
    // Every bidder needs one of our salespeople assigned to it.
    const missingSalesperson = bidderMissingSalesperson(biddingRows);
    if (missingSalesperson) {
      return setEditProblem(`Select a salesperson for bidder "${missingSalesperson.company || "without a firm name"}".`);
    }

    const payload = {};
    EDITABLE_FIELDS.forEach(f => {
      payload[f] = editData[f] || null;
    });
    // One row per firm, with all of that firm's people grouped under it.
    payload.biddingCompanies = biddersForStorage(biddingRows);
    payload.splits = normalizeSplits(splitRows);
    // Everyone on the split works the entry, so it shows on their dashboard.
    payload.trackedByIds = withSplitMembers(pipeline.trackedByIds, splitRows);
    // Products quoted; not installed yet, so never a serial number. The
    // first row is mirrored into the older single-product fields.
    payload.equipment = productRowsForStorage(productRows);
    payload.towerManufacturer = payload.equipment[0]?.manufacturer || null;
    payload.modelNumber = payload.equipment[0]?.model || null;
    payload.serialNumber = null;

    // Post-Bid: nothing to chase for a while, so it comes back in a month
    // -- for everyone on the entry, since the date lives on the entry.
    if (movedToPostBid(pipeline, payload)) payload.nextCheckIn = postBidCheckIn();

    const stateEdits = stateChanges(pipeline, payload, "pipeline", ownerLabel);
    if (stateEdits.length) {
      payload.activityLog = withActivity(pipeline.activityLog, activityEntry({
        type: "changed",
        changes: stateEdits,
        by: uid,
        byName: myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : (auth.currentUser?.email || "Unknown")
      }));
    }

    await updateDoc(doc(db, "pipeline", pipelineId), payload);

    const captureEntries = [
      { companyName: editData.company, category: "Engineering Firm", contactName: editData.contact, email: editData.email, phone: editData.phone },
      ...bidderDirectoryEntries(payload.biddingCompanies, firmTypeOf)
    ];
    await ensureCompanyAndContactBatch(captureEntries, { companies, contacts, uid });

    // Only firms that weren't on the entry before, so saving an edit
    // doesn't re-alert everyone about the same firms.
    const addedFirms = newlyAddedFirms(pipeline, { company: editData.company, biddingCompanies: payload.biddingCompanies });
    const owners = firmOwnersFor(addedFirms, companies);
    await Promise.all([...owners.entries()]
      .filter(([personId]) => personId !== uid)
      .map(([personId, firmName]) => notifyUsers([personId], {
        type: "firm_on_entry",
        message: `${firmName} was added to the pipeline entry "${payload.title || pipeline.title}"`,
        link: `/dashboard/pipeline/${pipelineId}`
      })));

    await notifyUsers(
      newSplitMembers(pipeline, payload).filter(id => id !== uid),
      { type: "split_share", message: `You were given a share of "${payload.title || pipeline.title}"`, link: `/dashboard/pipeline/${pipelineId}` }
    );
    await Promise.all(
      payload.equipment.filter(isTowerRow).map(row => ensureTowerModel({ towerModels, manufacturer: row.manufacturer, model: row.model, uid }))
    );

    setIsEditing(false);
    await loadPipelineEntry(uid, role);
  };

  const uploadFile = async (fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    setFileProblem("");
    if (file.type !== "application/pdf") {
      return setFileProblem("Only PDF files can be uploaded here.");
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
      setFileProblem(err.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const deleteFile = (file) => setAsk({
    title: "Delete this file?",
    message: `"${file.name}" can't be brought back.`,
    confirmLabel: "Delete",
    danger: true,
    onConfirm: () => reallyDeleteFile(file)
  });

  const reallyDeleteFile = async (file) => {
    setAsk(null);
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

  // Two weeks out by default, and changeable -- some jobs you chase in a
  // week, some sit for a month.
  const openBidsSent = () => {
    setBidsSentDate(postBidCheckIn());
    setShowBidsSentModal(true);
  };

  const confirmBidsSent = async () => {
    setBidsSentProblem("");
    if (!bidsSentDate) return setBidsSentProblem("Pick a date to follow up on.");
    await updateDoc(doc(db, "pipeline", pipelineId), {
      stage: POST_BID,
      nextCheckIn: bidsSentDate,
      bidsSentAt: new Date().toISOString()
    });
    setShowBidsSentModal(false);
    await loadPipelineEntry(uid, role);
  };

  const confirmMarkWon = async () => {
    setWonProblem("");
    if (!wonContractor.trim()) return setWonProblem("Select which of the bidders won the job.");

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
      nextCheckIn: adjustWeekend(followUp.toISOString()),
      // Asked for on the Won box when the entry doesn't already carry
      // them, so the ship date is known before the job is even set up.
      ...(wonLeadTime.trim() ? { leadTime: wonLeadTime.trim() } : {}),
      ...(wonOrderedOn ? { orderedOn: wonOrderedOn } : {})
    });
    setShowWonModal(false);
    setWonContractor("");
    setWonLeadTime("");
    setWonOrderedOn("");
    await loadPipelineEntry(uid, role);
    // Won work becomes a project; there's no reason to make someone go
    // looking for the button. The winner is handed over directly -- see
    // openConvert on why reading it back off state doesn't work here.
    openConvert(wonContractor.trim());
  };

  const confirmMarkLost = async () => {
    setLostProblem("");
    if (lostModalOutcome === "Did Not Bid") {
      const problem = didNotBidProblem(dnbChoice, lostReason);
      if (problem) return setLostProblem(problem);
    } else if (!lostReason.trim()) {
      return setLostProblem("Say why this was lost.");
    }
    await updateDoc(doc(db, "pipeline", pipelineId), {
      outcome: lostModalOutcome,
      wonByContractor: null,
      lostReason: lostModalOutcome === "Did Not Bid"
        ? didNotBidReason(dnbChoice, lostReason)
        : lostReason.trim(),
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
  // `wonBy` is passed in when this is opened straight after marking the
  // job won: the reload has happened but this closure still holds the
  // pipeline object from before it, so reading wonByContractor off state
  // gave nothing and the modal asked for a firm it had just been told.
  const openConvert = (wonBy = null) => {
    const winnerName = wonBy || pipeline.wonByContractor || "";
    const winner = groupBidders(pipeline.biddingCompanies).find(
      b => (b.company || "").toLowerCase() === winnerName.toLowerCase()
    );
    const winnerContact = contactsOf(winner)[0] || {};
    setConvertData({
      salespersonId: pipeline.salespersonId || pipeline.ownerId || "",
      companyCategory: firmTypeOf(winner?.category),
      company: winner?.company || winnerName,
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
    // The date is the only thing nobody can work out from the entry.
    // A thin field is carried across as-is and fixed on the project --
    // blocking the conversion over it just strands a won job in the
    // pipeline.
    const missing = [];
    if (!convertNextDate) missing.push("Next Check-In Date");
    setConvertProblem("");
    if (missing.length) {
      return setConvertProblem(`Fill in: ${missing.join(", ")}.`);
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
        // Won work is equipment on order, not a job already running.
        category: "Order",
        buildingSector: convertData.buildingSector,
        projectValue: pipeline.value || null,
        workType: convertData.workType,
        projectAddress: convertProjectAddress,
        equipment,
        towerManufacturer: first.manufacturer || pipeline.towerManufacturer || null,
        modelNumber: first.model || pipeline.modelNumber || null,
        serialNumber: null,
        nextCheckIn: convertNextDate,
        lastContact: now.split("T")[0],
        activityLog: [{ type: "converted", outcome: "From won pipeline entry", notes: `Converted by ${myName}`, timestamp: now }],
        ownerId: convertData.salespersonId,
        splits: normalizeSplits(pipeline.splits),
        collaboratorIds: withSplitMembers([], pipeline.splits, convertData.salespersonId),
        projectPointPersonId: pipeline.projectPointPersonId || null,
        // The lead time and its dates follow the work across.
        leadTime: pipeline.leadTime || null,
        leadTimeAlerts: pipeline.leadTimeAlerts === true,
        orderedOn: pipeline.orderedOn || null,
        shippedOn: pipeline.shippedOn || null,
        deliveredOn: pipeline.deliveredOn || null,
        sourcePipelineId: pipeline.id,
        bidHistory: buildBidSnapshot(pipeline),
        createdAt: now
      });

      await setDoc(doc(db, "customers", ref3.id, "private", "data"), {
        notes: privateData?.notes || "",
        notesHistory: privateData?.notesHistory || [],
        bidFiles: privateData?.files || []
      });

      const pipelinePhotos = await getDocs(collection(db, "pipeline", pipelineId, "photos"));
      await Promise.all(pipelinePhotos.docs.map(d =>
        addDoc(collection(db, "customers", ref3.id, "photos"), { ...d.data(), fromPipeline: true })
      ));

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
      setConvertProblem(`Couldn't create the project: ${err.message}`);
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
          <h3 className="modal-title">{notFound === "trash" ? "This pipeline entry is in the trash" : "Pipeline entry not found"}</h3>
          <p className="modal-subtitle">
            {notFound === "trash"
              ? "It was deleted. Its owner (or an admin) can revive it from Trash in User Settings within 30 days."
              : "It may have been deleted."}
          </p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#pipeline")}>Back to Pipeline</button>
        </div>
      </div>
    );
  }

  if (!pipeline || !role) {
    return <div className="dashboard-page">Loading...</div>;
  }

  // Firms for "who won it": everything in the Directory plus any bidder on
  // this entry that isn't in it yet.
  // Who can be marked as having won: the firms on this entry's bidder
  // list, nobody else.
  const wonCandidates = [...new Set(
    groupBidders(pipeline.biddingCompanies).map(b => (b.company || "").trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  const firmsWithBidders = [
    ...companies,
    ...(pipeline.biddingCompanies || [])
      .filter(b => b.company && !companies.some(c => sameCompany(c.name, b.company)))
      .map(b => ({ id: `bidder-${b.company}`, name: b.company, category: b.category || "Contractor" }))
  ];

  // Shown with the details normally, and in the lower row while editing.
  // The bid date has been and gone and nobody has said what happened.
  // Until someone answers, the entry sits in Pre-Bid looking like work
  // that hasn't started, and the bid-date alert nags everyone on it
  // forever without asking the question that would clear it.
  const todayIso = new Date().toISOString().slice(0, 10);
  const bidDatePassed =
    !!pipeline.bidDate &&
    String(pipeline.bidDate).slice(0, 10) < todayIso &&
    !pipeline.outcome &&
    pipeline.stage !== POST_BID;

  // It's the salesperson's and the point person's job to answer, so the
  // banner says so by name -- a prompt addressed to everybody is a prompt
  // addressed to nobody.
  // Salesperson and point person if there are any; otherwise it falls to
  // whoever entered it, which is the same rule the alert uses.
  const assigned = [pipeline.salespersonId, pipeline.projectPointPersonId]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  const answerableBy = assigned.length ? assigned : [pipeline.ownerId].filter(Boolean);
  const forMe = answerableBy.includes(uid);

  const outcomeSection = (
    <div className="project-section">
      <h4 className="field-label">Outcome</h4>
      {/* Two steps, not three buttons at once. Before the bid goes out the
          only honest answers are "we're bidding it" or "we're not"; asking
          won or lost then left an entry with three buttons nobody could
          press for weeks. Once bids are sent it's Post-Bid, and the only
          question left is how it went. */}
      {!pipeline.outcome && pipeline.stage !== POST_BID && (
        <>
          <p className="private-note-hint">Bids haven&apos;t gone out yet.</p>
          {canEdit && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={openBidsSent}>Bids Sent</button>
              <button className="btn btn-secondary" onClick={() => { setDnbChoice(""); setLostReason(""); setLostProblem(""); setLostModalOutcome("Did Not Bid"); }}>Not Bidding</button>
            </div>
          )}
        </>
      )}

      {!pipeline.outcome && pipeline.stage === POST_BID && (
        <>
          <p className="private-note-hint">
            Bid is in — waiting to hear.
            {pipeline.nextCheckIn ? ` Following up ${String(pipeline.nextCheckIn).slice(0, 10)}.` : ""}
          </p>
          {canEdit && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => setShowWonModal(true)}>Mark Won</button>
              <button className="btn btn-danger" onClick={() => { setDnbChoice(""); setLostReason(""); setLostProblem(""); setLostModalOutcome("Lost"); }}>Mark Lost</button>
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
        {bidDatePassed && (
          <div className="duplicate-warning" style={{ marginBottom: 16 }}>
            <strong>
              The bid date passed on {String(pipeline.bidDate).slice(0, 10)}
              {forMe ? " — did we bid it?" : "."}
            </strong>
            <div className="private-note-hint" style={{ marginTop: 4 }}>
              {answerableBy.length
                ? `${answerableBy.map(id => ownerLabel(id)).join(" and ")} to answer${assigned.length ? "" : " — nobody else is on this entry"}.`
                : "Nobody is on this entry at all."}
              {" "}Saying bids went out moves it to Post-Bid and puts a follow-up on the calendar;
              won or lost comes later, whenever you hear.
            </div>
            {canEdit && (
              <div className="duplicate-warning-actions">
                <button className="btn btn-primary" onClick={openBidsSent}>Bids Sent</button>
                <button className="btn btn-secondary" onClick={() => { setDnbChoice(""); setLostReason(""); setLostProblem(""); setLostModalOutcome("Did Not Bid"); }}>Not Bidding</button>
              </div>
            )}
          </div>
        )}

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
                <LeadTimeSummary record={pipeline} subject="This job" />
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
            {isEditing && editProblem && <p className="settings-status is-error">⚠ {editProblem}</p>}
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
                <MoneyInput name="pd-value" value={editData.value} onChange={v => setEditData(prev => ({ ...prev, value: v }))} />
              </div>
              <WorkTypeSelect id="pipeline-detail-work-type" value={editData.workType} onChange={v => setEditData({ ...editData, workType: v })} />
              <h4 className="field-label" style={{ marginTop: 16 }}>Equipment Lead Time</h4>
              <LeadTimeFields
                idPrefix="pipeline-detail"
                values={editData}
                setValues={setEditData}
                /* Winning the bid is when the equipment gets ordered, so
                   that is when an order date means something -- the same
                   moment a project reaching Order does. Before that a
                   lead time here is still just a note. */
                allowAlerts={pipeline.outcome === "Won"}
              />
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
                onCompanyChange={v => setEditData(prev => ({
                  ...prev,
                  company: v,
                  salespersonId: salespersonAfterFirmChange({ companies, users, previousFirm: prev.company, nextFirm: v, currentSalespersonId: prev.salespersonId })
                }))}
                onContactChange={v => setEditData(prev => ({ ...prev, contact: v }))}
                onEmailChange={v => setEditData(prev => ({ ...prev, email: v }))}
                onPhoneChange={v => setEditData(prev => ({ ...prev, phone: v }))}
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

            <h4 className="field-label" style={{ marginTop: 16 }}>Credit Split</h4>
            <CreditSplitEditor idPrefix="pipeline-detail-split" users={users} value={splitRows} onChange={setSplitRows} ownerId={editData.salespersonId || pipeline.ownerId} />

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
            <ProductOptionsEditor
              idPrefix="pipeline-detail-product"
              rows={productRows}
              onChange={setProductRows}
              products={products}
              history={{ projects: pastProjects }}
            />
          </div>
        ) : (
          <>
            <div className="detail-grid">
              <div className="project-section">
                <h4 className="field-label">Bid & Team</h4>
                <dl className="detail-list">
                  <dt>Bid Date</dt><dd>{pipeline.bidDate || "—"}</dd>
                  <dt>Est. Value</dt><dd>{withDollar(pipeline.value) || "—"}</dd>
                  <dt>Work Type</dt><dd>{pipeline.workType || "—"}</dd>
                  <dt>Sector</dt><dd>{pipeline.buildingSector || "—"}</dd>
                  <dt>Salesperson</dt><dd>{pipeline.salespersonId ? ownerLabel(pipeline.salespersonId) : "Unassigned"}</dd>
                  <dt>Point Person</dt><dd>{pipeline.projectPointPersonId ? ownerLabel(pipeline.projectPointPersonId) : "Unassigned"}</dd>
                  <dt>Credit Split</dt><dd>{normalizeSplits(pipeline.splits).length ? describeSplit(pipeline.splits, ownerLabel) : "Not split"}</dd>
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
                <div className="section-head-row">
                  <h4 className="field-label" style={{ margin: 0 }}>Contractors & Owners Bidding</h4>
                  {groupBidders(pipeline.biddingCompanies).length > 0 && (
                    <ExportButtons
                      label="the bidders on this entry"
                      buttonText="Export bidders list"
                      onExport={format => exportBidders(format)}
                    />
                  )}
                </div>
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
            <PipelineMyAlerts pipeline={pipeline} uid={uid} users={users} />
          )}

          {uid && (
            <PipelineNotes
              pipelineId={pipelineId}
              uid={uid}
              myName={myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : (auth.currentUser?.email || "Unknown")}
              legacyNotes={canSeeNotes ? privateData?.notes : ""}
              legacyHistory={canSeeNotes ? privateData?.notesHistory : []}
            />
          )}

          <div className="project-section">
            <h4 className="field-label">Files (PDF)</h4>

            {!canSeeNotes && (
              <p className="private-note-hint"><Icon name="lock" size={11} /> Files are private to {ownerLabel(pipeline.ownerId)}.</p>
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
                    {fileProblem && <p className="settings-status is-error">⚠ {fileProblem}</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {uid && (
          <PhotoGallery
            kind="pipeline"
            recordId={pipelineId}
            uid={uid}
            myName={myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : auth.currentUser?.email}
            canAdd
            canManageAll={isOwner || role === "admin"}
            limit={5}
          />
        )}

      </div>

      {showBidsSentModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <button className="modal-close" onClick={() => setShowBidsSentModal(false)}>✕</button>
            <h3 className="modal-title">Bids Sent</h3>
            <p className="modal-subtitle">
              Moves this to Post-Bid and puts a follow-up on your calendar. Mark it won or lost
              whenever you hear — before this date or long after.
            </p>

            <label className="field-label" htmlFor="bids-sent-follow-up">Follow up on</label>
            <input
              id="bids-sent-follow-up"
              className="field"
              type="date"
              value={bidsSentDate}
              onChange={e => setBidsSentDate(e.target.value)}
            />
            <p className="private-note-hint">Two weeks out by default.</p>

            {bidsSentProblem && <p className="settings-status is-error">⚠ {bidsSentProblem}</p>}
            <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={confirmBidsSent}>
              Confirm
            </button>
          </div>
        </div>
      )}

      {showWonModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <button className="modal-close" onClick={() => setShowWonModal(false)}>✕</button>
            <h3 className="modal-title">Mark as Won</h3>
            <p className="modal-subtitle">Which contractor or owner won the job?</p>

            <label className="field-label" htmlFor="won-contractor">Winning Firm</label>
            {/* Only the firms that actually bid this job, and picked from
                a list rather than typed. A winner who was never a bidder
                means the bidder list is wrong, and that's worth fixing
                there instead of quietly inventing a firm here. */}
            {wonCandidates.length === 0 ? (
              <p className="private-note-hint">
                Nobody is listed as bidding this job yet. Add them under Contractors &amp; Owners
                Bidding first, then come back and mark it won.
              </p>
            ) : (
              <select
                id="won-contractor"
                className="field"
                value={wonContractor}
                onChange={e => setWonContractor(e.target.value)}
              >
                <option value="">Select the winning bidder...</option>
                {wonCandidates.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            )}

            {/* Only asked when the entry doesn't already carry them --
                there's no sense making someone retype a lead time they
                put on at quote time. */}
            {!pipeline.leadTime && (
              <>
                <h4 className="field-label" style={{ marginTop: 16 }}>Lead time (longest component)</h4>
                <LeadTimeInput
                  idPrefix="won-lead"
                  value={wonLeadTime}
                  onChange={setWonLeadTime}
                  defaultUnit="weeks"
                />
                <p className="private-note-hint">Optional now — it can go on the project later.</p>
              </>
            )}
            {!pipeline.orderedOn && (
              <>
                <label className="field-label" htmlFor="won-ordered-on" style={{ marginTop: 12 }}>Ordered on</label>
                <input
                  id="won-ordered-on"
                  className="field"
                  type="date"
                  value={wonOrderedOn}
                  onChange={e => setWonOrderedOn(e.target.value)}
                />
                <p className="private-note-hint">The ship date is figured from here.</p>
              </>
            )}

            {wonProblem && <p className="settings-status is-error">⚠ {wonProblem}</p>}
            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 12 }}
              disabled={!wonContractor}
              onClick={confirmMarkWon}
            >
              Confirm
            </button>
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
            {lostModalOutcome === "Did Not Bid" ? (
              <>
                {/* Two buttons for the answers it nearly always is, so the
                    same reason isn't spelled six ways and can be counted. */}
                <div className="reason-picker">
                  {DID_NOT_BID_REASONS.map(reason => (
                    <button
                      key={reason}
                      type="button"
                      className={`btn btn-secondary ${dnbChoice === reason ? "is-picked" : ""}`}
                      aria-pressed={dnbChoice === reason}
                      onClick={() => { setDnbChoice(reason); setLostReason(""); setLostProblem(""); }}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
                {dnbChoice === OTHER && (
                  <textarea
                    id="pipeline-lost-reason"
                    className="field"
                    style={{ width: "100%", height: 80, marginTop: 8 }}
                    placeholder="What was the reason?"
                    value={lostReason}
                    onChange={e => setLostReason(e.target.value)}
                  />
                )}
              </>
            ) : (
              <textarea id="pipeline-lost-reason" className="field" style={{ width: "100%", height: 80 }} value={lostReason} onChange={e => setLostReason(e.target.value)} />
            )}

            <label className="field-label" htmlFor="pipeline-lost-to">Who won it? (optional)</label>
            <FirmSelect id="pipeline-lost-to" companies={firmsWithBidders} category="Contractor" value={lostTo} onChange={setLostTo} placeholder="Select or search firm..." newLabel="firm" />

            {lostProblem && <p className="settings-status is-error">⚠ {lostProblem}</p>}
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
              Files &quot;{pipeline.title}&quot; as a project on order. The bid details, bidders, notes
              and files stay with it on its Bid History tab.
            </p>

            {/* Everything here is already known -- the winning bidder is
                the firm and the contact, and the rest came off the entry.
                Re-asking for it invited someone to type something
                different from what they'd just recorded. Only what's
                genuinely missing gets a field. */}
            <dl className="detail-list">
              <dt>Firm</dt>
              <dd>{convertData.company || "—"}{convertData.companyCategory ? ` (${convertData.companyCategory})` : ""}</dd>
              <dt>Contact</dt>
              <dd>
                {convertData.contact || "—"}
                {(convertData.email || convertData.phone) && (
                  <div className="private-note-hint">{[convertData.email, convertData.phone].filter(Boolean).join(" · ")}</div>
                )}
              </dd>
              <dt>Salesperson</dt>
              <dd>{ownerLabel(convertData.salespersonId) || "—"}</dd>
              <dt>Sector</dt><dd>{convertData.buildingSector || "—"}</dd>
              <dt>Work type</dt><dd>{convertData.workType || "—"}</dd>
              <dt>Address</dt><dd>{convertProjectAddress || "—"}</dd>
            </dl>

            {/* One field. Everything else came off the entry -- the
                winning bidder is the firm and the contact, the address,
                sector and work type are the entry's own. Anything thin
                gets fixed on the project afterwards; asking here just
                invited someone to type something different from what
                they had already recorded. */}
            <div>
              <label className="field-label" htmlFor="convert-next-date">Next check-in date</label>
              <input id="convert-next-date" className="field" type="date" value={convertNextDate} onChange={e => setConvertNextDate(e.target.value)} />
              <p className="private-note-hint">When it should come back round on your schedule. Everything else is editable on the project.</p>
            </div>

            {convertProblem && <p className="settings-status is-error">⚠ {convertProblem}</p>}
            <div className="modal-actions">
              <button className="btn btn-primary" disabled={converting} onClick={convertToProject}>{converting ? "Creating…" : "Create Project"}</button>
              <button className="btn btn-secondary" onClick={() => setShowConvertModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {ask && (
        <ConfirmDialog
          title={ask.title}
          confirmLabel={ask.confirmLabel}
          danger={ask.danger === true}
          onCancel={() => setAsk(null)}
          onConfirm={ask.onConfirm}
        >
          <p>{ask.message}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
