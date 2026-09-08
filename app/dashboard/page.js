"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "firebase/auth";
import { auth, db, getSecondaryAuth } from "../../lib/firebase";
import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  deleteField,
  arrayUnion,
  arrayRemove
} from "firebase/firestore";
import { ensureCompanyAndContact, ensureCompanyAndContactBatch } from "../../lib/directory";
import { ensureTowerModel } from "../../lib/towerModels";
import CompanyContactFields from "../components/CompanyContactFields";
import AddressAutocomplete from "../components/AddressAutocomplete";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const CATEGORY_OPTIONS = ["Pre-Bid", "Bidding", "Prospecting", "Ongoing Project", "Order", "Parts", "Project Closed"];
const PIPELINE_STAGE_OPTIONS = ["Pre-Bid", "Bidding", "Design", "Budgeting"];

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

export default function Dashboard() {
  const router = useRouter();

  // AUTH / PROFILE
  const [uid, setUid] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [role, setRole] = useState(null); // 'admin' | 'member' | null (loading)
  const [view, setView] = useState("home"); // 'home' | 'personal' | 'team' | 'admin'
  const [selectedCalendarDay, setSelectedCalendarDay] = useState(null); // null = "this week" panel

  // NAME COLLECTION (first login without a name on file)
  const [needsName, setNeedsName] = useState(false);
  const [nameFirst, setNameFirst] = useState("");
  const [nameLast, setNameLast] = useState("");
  const [myProfile, setMyProfile] = useState(null);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [notifySundayDigest, setNotifySundayDigest] = useState(true);
  const [notifyWednesdayDigest, setNotifyWednesdayDigest] = useState(true);
  const [notifyCollabRequest, setNotifyCollabRequest] = useState(true);
  const [notifyCollabApproved, setNotifyCollabApproved] = useState(true);

  const [customers, setCustomers] = useState([]);
  const [notesById, setNotesById] = useState({});
  const [users, setUsers] = useState([]);
  const [pipelineEntries, setPipelineEntries] = useState([]);
  const [pipelineFilterOwner, setPipelineFilterOwner] = useState("all");
  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [towerModels, setTowerModels] = useState([]);

  // COLLABORATION
  const [requestsById, setRequestsById] = useState({}); // customerId -> pending requests on entries I own
  const [requestedIds, setRequestedIds] = useState(new Set()); // customerIds I've just requested (optimistic)
  const [teamFilterOwner, setTeamFilterOwner] = useState("all");

  // FORM
  const [projectName, setProjectName] = useState("");
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("");
  const [projectValue, setProjectValue] = useState("");
  const [equipmentType, setEquipmentType] = useState("");
  const [towerManufacturer, setTowerManufacturer] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [dateInstalled, setDateInstalled] = useState("");
  const [projectAddress, setProjectAddress] = useState("");

  // PIPELINE FORM
  const [pipelineTitle, setPipelineTitle] = useState("");
  const [pipelineStage, setPipelineStage] = useState("Pre-Bid");
  const [pipelineBidDate, setPipelineBidDate] = useState("");
  const [pipelineValue, setPipelineValue] = useState("");
  const [pipelineCompany, setPipelineCompany] = useState("");
  const [pipelineContact, setPipelineContact] = useState("");
  const [pipelineEmail, setPipelineEmail] = useState("");
  const [pipelinePhone, setPipelinePhone] = useState("");
  const [pipelineNotes, setPipelineNotes] = useState("");
  const [pipelineTowerManufacturer, setPipelineTowerManufacturer] = useState("");
  const [pipelineModelNumber, setPipelineModelNumber] = useState("");
  const [pipelineSerialNumber, setPipelineSerialNumber] = useState("");
  const [biddingCompanies, setBiddingCompanies] = useState([]);
  const [showAddPipelineModal, setShowAddPipelineModal] = useState(false);

  // NEW MODAL STATE
  const [showAddModal, setShowAddModal] = useState(false);

  // EDIT
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  // MODAL
  const [selected, setSelected] = useState(null);
  const [modalNotes, setModalNotes] = useState("");

  // COMPLETED
  const [completedTarget, setCompletedTarget] = useState(null);
  const [contactMethod, setContactMethod] = useState("phone");

  // TOAST
  const [toast, setToast] = useState("");

  // SEARCH
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // ADMIN: create user form
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("member");
  const [newUserFirstName, setNewUserFirstName] = useState("");
  const [newUserLastName, setNewUserLastName] = useState("");

  const col = collection(db, "customers");

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 5000);
  };

  const clearForm = () => {
    setProjectName("");
    setCompany("");
    setContact("");
    setEmail("");
    setPhone("");
    setNextDate("");
    setNotes("");
    setCategory("");
    setProjectValue("");
    setEquipmentType("");
    setTowerManufacturer("");
    setModelNumber("");
    setSerialNumber("");
    setDateInstalled("");
    setProjectAddress("");
  };

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

  const getDateValue = (date) => {
    if (!date) return 0;
    if (date?.seconds) return date.seconds * 1000;
    return new Date(date).getTime();
  };

  const adjustWeekend = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    if (day === 6) d.setDate(d.getDate() + 2);
    if (day === 0) d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  };

  const todayValue = new Date().getTime();

  const diffDays = (date) =>
    (getDateValue(date) - todayValue) / (1000 * 60 * 60 * 24);

  const loadCustomers = async (currentUid, isAdmin) => {
    const snap = await getDocs(col);
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Migrate legacy customers with no owner to whichever admin loads them.
    const orphans = list.filter(c => !c.ownerId);
    if (isAdmin && orphans.length) {
      await Promise.all(
        orphans.map(c => updateDoc(doc(db, "customers", c.id), { ownerId: currentUid }))
      );
      list = list.map(c => (c.ownerId ? c : { ...c, ownerId: currentUid }));
    }

    setCustomers(list);

    const owned = list.filter(c => c.ownerId === currentUid);
    const collaborating = list.filter(c => (c.collaboratorIds || []).includes(currentUid));
    const mine = [...owned, ...collaborating];

    const noteEntries = await Promise.all(
      mine.map(async (c) => {
        const noteRef = doc(db, "customers", c.id, "private", "data");
        const noteSnap = await getDoc(noteRef);
        let data;

        if (noteSnap.exists()) {
          data = noteSnap.data();
        } else if ("notes" in c || "notesHistory" in c) {
          // One-time repair: earlier versions of this app stored notes
          // directly on the public customer doc. If a private copy doesn't
          // exist yet but the legacy public fields do, move them over now
          // and strip them off the public doc so they're actually private.
          data = { notes: c.notes || "", notesHistory: c.notesHistory || [] };
          await setDoc(noteRef, data);
          await updateDoc(doc(db, "customers", c.id), {
            notes: deleteField(),
            notesHistory: deleteField()
          });
        } else {
          data = { notes: "", notesHistory: [] };
        }

        // Backfill authorship on legacy notes -- collaboration didn't exist
        // before this feature, so anything unattributed was written by the
        // owner. Persist it so this only has to run once per entry.
        const needsBackfill =
          (data.notes && !data.notesAuthorId) ||
          (data.notesHistory || []).some(h => !h.authorId);

        if (needsBackfill) {
          const ownerSnap = await getDoc(doc(db, "users", c.ownerId));
          const ownerData = ownerSnap.exists() ? ownerSnap.data() : {};
          const ownerName = ownerData.firstName && ownerData.lastName
            ? `${ownerData.firstName} ${ownerData.lastName}`
            : (ownerData.email || "Unknown");

          data = {
            ...data,
            notesAuthorId: data.notes ? (data.notesAuthorId || c.ownerId) : (data.notesAuthorId || null),
            notesAuthorName: data.notes ? (data.notesAuthorName || ownerName) : (data.notesAuthorName || null),
            notesHistory: (data.notesHistory || []).map(h => ({
              ...h,
              authorId: h.authorId || c.ownerId,
              authorName: h.authorName || ownerName
            }))
          };

          await setDoc(noteRef, data);
        }

        return [c.id, data];
      })
    );
    setNotesById(Object.fromEntries(noteEntries));

    // Pending collaboration requests on entries I own.
    const requestEntries = await Promise.all(
      owned.map(async (c) => {
        const reqSnap = await getDocs(collection(db, "customers", c.id, "collabRequests"));
        return [c.id, reqSnap.docs.map(d => ({ id: d.id, ...d.data() }))];
      })
    );
    setRequestsById(Object.fromEntries(requestEntries));
  };

  const loadUsers = async () => {
    const snap = await getDocs(collection(db, "users"));
    setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  const loadPipeline = async () => {
    const snap = await getDocs(collection(db, "pipeline"));
    setPipelineEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  const loadDirectory = async () => {
    const [companiesSnap, contactsSnap] = await Promise.all([
      getDocs(collection(db, "companies")),
      getDocs(collection(db, "contacts"))
    ]);
    setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  const loadTowerModels = async () => {
    const snap = await getDocs(collection(db, "towerModels"));
    setTowerModels(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  const sendNotificationEmail = async (to, subject, html) => {
    try {
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, html })
      });
    } catch {
      // best-effort -- don't let a failed email break the actual action
    }
  };

  const requestCollaborate = async (c) => {
    const requesterName = myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : auth.currentUser?.email;

    await setDoc(doc(db, "customers", c.id, "collabRequests", uid), {
      requesterId: uid,
      requesterName,
      requestedAt: new Date().toISOString()
    });
    setRequestedIds(prev => new Set(prev).add(c.id));
    showToast("Collaboration requested");

    const owner = users.find(u => u.id === c.ownerId);
    const projectLabel = c.projectName || c.company;
    if (owner?.email && owner.notifyCollabRequest !== false) {
      sendNotificationEmail(
        owner.email,
        `${requesterName} wants to collaborate on ${projectLabel}`,
        `<p>${requesterName} has requested to collaborate on <strong>${projectLabel}</strong>. Log in to your CRM dashboard to approve or deny.</p>`
      );
    }
  };

  const approveRequest = async (customerId, request) => {
    await updateDoc(doc(db, "customers", customerId), {
      collaboratorIds: arrayUnion(request.requesterId)
    });
    await deleteDoc(doc(db, "customers", customerId, "collabRequests", request.id));
    showToast(`${request.requesterName} can now collaborate on this entry`);

    const requester = users.find(u => u.id === request.requesterId);
    const c = customers.find(c => c.id === customerId);
    const projectLabel = c?.projectName || c?.company || "an entry";
    if (requester?.email && requester.notifyCollabApproved !== false) {
      sendNotificationEmail(
        requester.email,
        `You can now collaborate on ${projectLabel}`,
        `<p>Your request to collaborate on <strong>${projectLabel}</strong> was approved. It now shows up in your My Dashboard.</p>`
      );
    }

    loadCustomers(uid, role === "admin");
  };

  const denyRequest = async (customerId, request) => {
    await deleteDoc(doc(db, "customers", customerId, "collabRequests", request.id));
    showToast("Request denied");
    loadCustomers(uid, role === "admin");
  };

  // Works both ways: an owner revoking someone else's access, or a
  // collaborator revoking their own -- either way the entry goes back to
  // exactly how it was before the request was made.
  const revokeCollaborator = async (customerId, collaboratorId) => {
    await updateDoc(doc(db, "customers", customerId), {
      collaboratorIds: arrayRemove(collaboratorId)
    });
    showToast("Collaboration access removed");
    loadCustomers(uid, role === "admin");
  };


  const saveName = async () => {
    if (!nameFirst.trim() || !nameLast.trim()) {
      return alert("Please enter both first and last name");
    }
    const firstName = nameFirst.trim();
    const lastName = nameLast.trim();

    await updateDoc(doc(db, "users", uid), { firstName, lastName });
    setMyProfile(prev => ({ ...(prev || {}), email: auth.currentUser?.email, role, firstName, lastName }));
    setNeedsName(false);
    await loadCustomers(uid, role === "admin");
  };

  const saveNotificationSettings = async () => {
    await updateDoc(doc(db, "users", uid), {
      notifySundayDigest,
      notifyWednesdayDigest,
      notifyCollabRequest,
      notifyCollabApproved
    });
    setMyProfile(prev => ({ ...(prev || {}), notifySundayDigest, notifyWednesdayDigest, notifyCollabRequest, notifyCollabApproved }));
    showToast("Notification settings saved");
    setShowUserSettings(false);
  };

  const logout = async () => {
    clearSession();
    await signOut(auth);
    router.push("/");
  };

  // SESSION GUARD + PROFILE LOAD
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
        const userRef = doc(db, "users", user.uid);
        const profileSnap = await getDoc(userRef);
        let profile;

        if (profileSnap.exists()) {
          profile = profileSnap.data();
        } else {
          // Profile doesn't exist yet (e.g. resumed session that never went
          // through the login page's bootstrap). Create it here too, same
          // first-user-becomes-admin rule as page.js.
          const configRef = doc(db, "system", "config");
          const configSnap = await getDoc(configRef);
          const isFirstUser = !configSnap.exists();

          profile = {
            email: user.email,
            role: isFirstUser ? "admin" : "member",
            disabled: false,
            createdAt: new Date().toISOString()
          };

          await setDoc(userRef, profile);
          if (isFirstUser) {
            await setDoc(configRef, { bootstrapped: true, createdAt: new Date().toISOString() });
          }
        }

        if (profile.disabled) {
          clearSession();
          await signOut(auth);
          router.push("/");
          return;
        }

        setRole(profile.role || "member");
        loadUsers();

        if (!profile.firstName || !profile.lastName) {
          setNeedsName(true);
        } else {
          setMyProfile(profile);
          setNotifySundayDigest(profile.notifySundayDigest !== false);
          setNotifyWednesdayDigest(profile.notifyWednesdayDigest !== false);
          setNotifyCollabRequest(profile.notifyCollabRequest !== false);
          setNotifyCollabApproved(profile.notifyCollabApproved !== false);
          await loadCustomers(user.uid, profile.role === "admin");
          await loadPipeline();
          await loadDirectory();
          await loadTowerModels();
        }
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading your account.");
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (view === "team" || view === "admin") {
      loadUsers();
    }
  }, [view, role]);

  // ADD
  const addCustomer = async () => {
    if (!projectName || !contact || !nextDate || !projectAddress) {
      return alert("Please fill required fields, including the project address");
    }

    const ref = await addDoc(col, {
      projectName,
      company,
      contact,
      email,
      phone,
      category: category || null,
      projectValue: projectValue || null,
      equipmentType: equipmentType || null,
      towerManufacturer: towerManufacturer || null,
      modelNumber: modelNumber || null,
      serialNumber: serialNumber || null,
      dateInstalled: dateInstalled || null,
      projectAddress: projectAddress || null,
      nextCheckIn: adjustWeekend(nextDate),
      lastContact: new Date().toISOString().split("T")[0],
      activityLog: [],
      ownerId: uid,
      collaboratorIds: [],
      createdAt: new Date().toISOString()
    });

    await setDoc(doc(db, "customers", ref.id, "private", "data"), {
      notes,
      notesHistory: []
    });

    ensureCompanyAndContact({
      companies, contacts, companyName: company, category: "Customer",
      contactName: contact, email, phone, uid
    }).then(loadDirectory);

    ensureTowerModel({ towerModels, manufacturer: towerManufacturer, model: modelNumber, uid }).then(loadTowerModels);

    clearForm();
    setShowAddModal(false);

    showToast("Customer added");
    loadCustomers(uid, role === "admin");
  };

  // PIPELINE
  const clearPipelineForm = () => {
    setPipelineTitle("");
    setPipelineStage("Pre-Bid");
    setPipelineBidDate("");
    setPipelineValue("");
    setPipelineCompany("");
    setPipelineContact("");
    setPipelineEmail("");
    setPipelinePhone("");
    setPipelineNotes("");
    setBiddingCompanies([]);
    setPipelineTowerManufacturer("");
    setPipelineModelNumber("");
    setPipelineSerialNumber("");
  };

  const addBiddingCompanyRow = () => {
    setBiddingCompanies(prev => [...prev, { company: "", contact: "", email: "", phone: "" }]);
  };

  const updateBiddingCompanyRow = (index, field, value) => {
    setBiddingCompanies(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const removeBiddingCompanyRow = (index) => {
    setBiddingCompanies(prev => prev.filter((_, i) => i !== index));
  };

  const addPipelineEntry = async () => {
    if (!pipelineTitle) {
      return alert("Please enter a project/opportunity name");
    }

    const ref = await addDoc(collection(db, "pipeline"), {
      title: pipelineTitle,
      stage: pipelineStage,
      bidDate: pipelineBidDate || null,
      value: pipelineValue || null,
      company: pipelineCompany || null,
      contact: pipelineContact || null,
      email: pipelineEmail || null,
      phone: pipelinePhone || null,
      biddingCompanies: biddingCompanies.filter(r => r.company || r.contact),
      towerManufacturer: pipelineTowerManufacturer || null,
      modelNumber: pipelineModelNumber || null,
      serialNumber: pipelineSerialNumber || null,
      ownerId: uid,
      convertedToProjectId: null,
      createdAt: new Date().toISOString()
    });

    await setDoc(doc(db, "pipeline", ref.id, "private", "data"), {
      notes: pipelineNotes,
      notesHistory: [],
      files: []
    });

    const captureEntries = [
      { companyName: pipelineCompany, category: "Engineering Firm", contactName: pipelineContact, email: pipelineEmail, phone: pipelinePhone },
      ...biddingCompanies
        .filter(r => r.company || r.contact)
        .map(r => ({ companyName: r.company, category: "Contractor", contactName: r.contact, email: r.email, phone: r.phone }))
    ];
    ensureCompanyAndContactBatch(captureEntries, { companies, contacts, uid }).then(loadDirectory);
    ensureTowerModel({ towerModels, manufacturer: pipelineTowerManufacturer, model: pipelineModelNumber, uid }).then(loadTowerModels);

    clearPipelineForm();
    setShowAddPipelineModal(false);

    showToast("Pipeline entry added");
    loadPipeline();
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setEditData({
      projectName: c.projectName || c.company || "",
      company: c.company || "",
      contact: c.contact || "",
      email: c.email || "",
      phone: c.phone || "",
      category: c.category || "",
      nextCheckIn: formatDate(c.nextCheckIn),
      lastContact: formatDate(c.lastContact)
    });
  };

  const saveEdit = async () => {
    await updateDoc(doc(db, "customers", editingId), {
      ...editData
    });

    ensureCompanyAndContact({
      companies, contacts, companyName: editData.company, category: "Customer",
      contactName: editData.contact, email: editData.email, phone: editData.phone, uid
    }).then(loadDirectory);

    setEditingId(null);
    setEditData({});
    showToast("Changes saved");
    loadCustomers(uid, role === "admin");
  };

  const deleteCustomer = async (id) => {
    if (!window.confirm("Delete this contact?")) return;
    await deleteDoc(doc(db, "customers", id));
    setSelected(null);
    showToast("Deleted");
    loadCustomers(uid, role === "admin");
  };

  const handleFollowUp = async (c) => {
    const next = new Date();
    next.setDate(next.getDate() + 7);

    await updateDoc(doc(db, "customers", c.id), {
      nextCheckIn: adjustWeekend(next.toISOString())
    });

    showToast("Follow-up scheduled");
    loadCustomers(uid, role === "admin");
  };

  const openCompletedPopup = (c) => {
    setCompletedTarget(c);
  };

  const confirmCompleted = async () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);

    const entry = {
      type: "completed",
      method: contactMethod,
      timestamp: new Date().toISOString()
    };

    await updateDoc(doc(db, "customers", completedTarget.id), {
      nextCheckIn: adjustWeekend(d.toISOString()),
      activityLog: [
        ...(completedTarget.activityLog || []),
        entry
      ]
    });

    setCompletedTarget(null);
    setContactMethod("phone");

    showToast("Marked completed");
    loadCustomers(uid, role === "admin");
  };

  const openModal = async (c) => {
    setSelected(c);
    const noteSnap = await getDoc(doc(db, "customers", c.id, "private", "data"));
    const data = noteSnap.exists() ? noteSnap.data() : { notes: "", notesHistory: [] };
    setNotesById(prev => ({ ...prev, [c.id]: data }));
    setModalNotes(data.notes || "");
  };

  const closeModal = () => setSelected(null);

  const saveModalNotes = async () => {
    const existing = notesById[selected.id] || { notes: "", notesHistory: [] };
    const original = existing.notes || "";
    const changed = original !== modalNotes;
    const myName = myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : (auth.currentUser?.email || "Unknown");

    const ref = doc(db, "customers", selected.id, "private", "data");

    const newHistory = changed && original
      ? [
          ...(existing.notesHistory || []),
          {
            text: original,
            date: new Date().toISOString(),
            authorId: existing.notesAuthorId || selected.ownerId,
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

    setSelected(null);
    setModalNotes("");
    showToast("Notes updated");
    loadCustomers(uid, role === "admin");
  };

  const deleteHistoryEntry = async (customerId, index) => {
    if (!window.confirm("Delete this note entry? This can't be undone.")) return;

    const existing = notesById[customerId] || { notesHistory: [] };
    const newHistory = (existing.notesHistory || []).filter((_, i) => i !== index);

    await setDoc(doc(db, "customers", customerId, "private", "data"), {
      ...existing,
      notesHistory: newHistory
    });

    setNotesById(prev => ({ ...prev, [customerId]: { ...existing, notesHistory: newHistory } }));
    showToast("Note entry deleted");
  };

  const filteredCustomers = useMemo(() => {
    let list = customers.filter(c => c.ownerId === uid || (c.collaboratorIds || []).includes(uid));
    list = [...list].sort(
      (a, b) => getDateValue(a.nextCheckIn) - getDateValue(b.nextCheckIn)
    );

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();

      list = list.filter(c =>
        (c.projectName || "").toLowerCase().includes(q) ||
        (c.company || "").toLowerCase().includes(q) ||
        (c.contact || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q) ||
        (c.projectAddress || "").toLowerCase().includes(q) ||
        (notesById[c.id]?.notes || "").toLowerCase().includes(q) ||
        (notesById[c.id]?.notesHistory || []).some(h => (h.text || "").toLowerCase().includes(q))
      );
    }

    return list;
  }, [customers, searchQuery, uid, notesById]);

  const teamCustomers = useMemo(() => {
    let list = [...customers].sort(
      (a, b) => getDateValue(a.nextCheckIn) - getDateValue(b.nextCheckIn)
    );

    if (teamFilterOwner !== "all") {
      list = list.filter(c => c.ownerId === teamFilterOwner);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();

      list = list.filter(c =>
        (c.projectName || "").toLowerCase().includes(q) ||
        (c.company || "").toLowerCase().includes(q) ||
        (c.contact || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q) ||
        (c.projectAddress || "").toLowerCase().includes(q) ||
        // Notes are only searchable here for entries you actually have
        // access to (owned/collaborating) -- notesById never contains
        // other people's private notes, so this can't leak anything.
        (notesById[c.id]?.notes || "").toLowerCase().includes(q) ||
        (notesById[c.id]?.notesHistory || []).some(h => (h.text || "").toLowerCase().includes(q))
      );
    }

    return list;
  }, [customers, searchQuery, teamFilterOwner, notesById]);

  const ownerLabel = (ownerId) => {
    if (ownerId === uid) return "You";
    const u = users.find(u => u.id === ownerId);
    if (!u) return "Teammate";
    return u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email;
  };

  const filteredPipeline = useMemo(() => {
    let list = [...pipelineEntries];

    if (pipelineFilterOwner !== "all") {
      list = list.filter(p => p.ownerId === pipelineFilterOwner);
    }

    return list.sort((a, b) => {
      const aDate = a.bidDate || "9999-99-99";
      const bDate = b.bidDate || "9999-99-99";
      return aDate.localeCompare(bDate);
    });
  }, [pipelineEntries, pipelineFilterOwner]);

  // HOME CALENDAR: next 4 weeks starting from the Sunday of the current week
  const calendarDays = useMemo(() => {
    const pad = n => String(n).padStart(2, "0");
    const toKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const dow = start.getDay(); // 0 = Sun ... 6 = Sat
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    start.setDate(start.getDate() + diffToMonday);

    const todayKey = toKey(new Date());

    const days = [];
    const cursor = new Date(start);
    while (days.length < 20) {
      const cursorDow = cursor.getDay();
      if (cursorDow !== 0 && cursorDow !== 6) {
        const key = toKey(cursor);
        days.push({ date: new Date(cursor), key, isToday: key === todayKey });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const weekKeys = useMemo(() => calendarDays.slice(0, 5).map(d => d.key), [calendarDays]);

  const myCalendarProjects = useMemo(() => {
    return customers.filter(c => c.ownerId === uid || (c.collaboratorIds || []).includes(uid));
  }, [customers, uid]);

  const projectsByDay = useMemo(() => {
    const map = {};
    myCalendarProjects.forEach(c => {
      const key = formatDate(c.nextCheckIn);
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(c);
    });
    return map;
  }, [myCalendarProjects]);

  const panelProjects = useMemo(() => {
    if (selectedCalendarDay) {
      return [...(projectsByDay[selectedCalendarDay] || [])].sort(
        (a, b) => (a.projectName || a.company || "").localeCompare(b.projectName || b.company || "")
      );
    }
    const weekSet = new Set(weekKeys);
    return myCalendarProjects
      .filter(c => weekSet.has(formatDate(c.nextCheckIn)))
      .sort((a, b) => getDateValue(a.nextCheckIn) - getDateValue(b.nextCheckIn));
  }, [selectedCalendarDay, projectsByDay, weekKeys, myCalendarProjects]);

  const panelTitle = selectedCalendarDay
    ? new Date(selectedCalendarDay + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : "This Week";

  // ADMIN
  const createUser = async () => {
    if (!newUserEmail) return alert("Enter an email");

    try {
      const secondaryAuth = getSecondaryAuth();
      const tempPassword = Math.random().toString(36).slice(-10) + "Aa1!";
      const cred = await createUserWithEmailAndPassword(secondaryAuth, newUserEmail, tempPassword);

      await setDoc(doc(db, "users", cred.user.uid), {
        email: newUserEmail,
        role: newUserRole,
        firstName: newUserFirstName.trim() || null,
        lastName: newUserLastName.trim() || null,
        disabled: false,
        createdAt: new Date().toISOString()
      });

      await sendPasswordResetEmail(secondaryAuth, newUserEmail);
      await signOut(secondaryAuth);

      try {
        await fetch("/api/verify-ses-identity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: newUserEmail })
        });
      } catch {
        // best-effort -- account creation already succeeded either way
      }

      setNewUserEmail("");
      setNewUserRole("member");
      setNewUserFirstName("");
      setNewUserLastName("");
      showToast("Account created — setup email + SES verification email sent");
      loadUsers();
    } catch (err) {
      alert(err.message || "Could not create account");
    }
  };

  const toggleUserRole = async (u) => {
    if (u.id === uid) {
      return alert("You can't change your own role. Ask another admin to do it.");
    }
    await updateDoc(doc(db, "users", u.id), {
      role: u.role === "admin" ? "member" : "admin"
    });
    loadUsers();
  };

  const toggleUserDisabled = async (u) => {
    if (u.id === uid) {
      return alert("You can't deactivate your own account.");
    }
    const nowDisabled = !u.disabled;

    await updateDoc(doc(db, "users", u.id), { disabled: nowDisabled });

    // Mirror to a publicly-readable lookup so the (unauthenticated) forgot
    // password screen can also refuse disabled accounts, not just login.
    if (nowDisabled) {
      await setDoc(doc(db, "disabledEmails", u.email), { disabled: true });
    } else {
      await deleteDoc(doc(db, "disabledEmails", u.email));
    }

    loadUsers();
  };

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load your account</h3>
          <p className="modal-subtitle">{loadError}</p>
          <p className="modal-subtitle">
            If this says "Missing or insufficient permissions," the Firestore security rules
            haven't been published yet in the Firebase console.
          </p>
          <button className="btn btn-secondary" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  if (!role) {
    return <div className="dashboard-page">Loading...</div>;
  }

  if (needsName) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 420 }}>
          <h3 className="modal-title">What's your name?</h3>
          <p className="modal-subtitle">We use this to identify you across the app.</p>

          <label className="field-label">First Name</label>
          <input className="field" name="nameFirst" autoComplete="off" value={nameFirst} onChange={e => setNameFirst(e.target.value)} />

          <label className="field-label">Last Name</label>
          <input className="field" name="nameLast" autoComplete="off" value={nameLast} onChange={e => setNameLast(e.target.value)} />

          <button className="btn btn-primary btn-block" onClick={saveName}>Continue</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">

      <div className="dashboard-header">
        <div className="dashboard-brand">
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">CRM Dashboard</h1>
        </div>
        <div className="dashboard-header-actions">
          {role === "admin" && (
            <button
              className="btn btn-secondary"
              onClick={() => setView(view === "admin" ? "personal" : "admin")}
            >
              {view === "admin" ? "Back to Dashboard" : "Settings"}
            </button>
          )}

          <div className="avatar-menu">
            <button className="avatar-circle">
              {`${myProfile?.firstName?.[0] || ""}${myProfile?.lastName?.[0] || ""}`.toUpperCase()}
            </button>
            <div className="avatar-dropdown">
              <div className="avatar-dropdown-card">
                <div className="avatar-dropdown-name">
                  {myProfile?.firstName} {myProfile?.lastName}
                </div>
                <div className="avatar-dropdown-email">{auth.currentUser?.email}</div>
                <div className="avatar-dropdown-role">
                  <span className={`role-badge ${role === "admin" ? "role-badge-admin" : ""}`}>{role}</span>
                </div>
                <button className="btn btn-secondary btn-block" onClick={() => setShowUserSettings(true)}>
                  User Settings
                </button>
              </div>
            </div>
          </div>

          <button className="btn btn-secondary" onClick={logout}>Logout</button>
        </div>
      </div>

      {showUserSettings && (
        <div className="modal-overlay">
          <div className="modal-card">
            <button className="modal-close" onClick={() => setShowUserSettings(false)}>✕</button>
            <h3 className="modal-title">User Settings</h3>

            <h4 className="field-label" style={{ marginTop: 4 }}>Email Notifications</h4>

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <input
                type="checkbox"
                checked={notifySundayDigest}
                onChange={e => setNotifySundayDigest(e.target.checked)}
              />
              Sunday evening digest (due this week + overdue)
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <input
                type="checkbox"
                checked={notifyWednesdayDigest}
                onChange={e => setNotifyWednesdayDigest(e.target.checked)}
              />
              Wednesday morning digest (due by Monday + overdue)
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <input
                type="checkbox"
                checked={notifyCollabRequest}
                onChange={e => setNotifyCollabRequest(e.target.checked)}
              />
              Someone requests to collaborate on my entry
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <input
                type="checkbox"
                checked={notifyCollabApproved}
                onChange={e => setNotifyCollabApproved(e.target.checked)}
              />
              My collaboration request is approved
            </label>

            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={saveNotificationSettings}>
              Save
            </button>
          </div>
        </div>
      )}

      {view !== "admin" && (
        <div className="view-tabs">
          <button
            className={`tab-btn ${view === "home" ? "tab-btn-active" : ""}`}
            onClick={() => setView("home")}
          >
            Home
          </button>
          <button
            className={`tab-btn ${view === "personal" ? "tab-btn-active" : ""}`}
            onClick={() => setView("personal")}
          >
            My Dashboard
          </button>
          <button
            className={`tab-btn ${view === "team" ? "tab-btn-active" : ""}`}
            onClick={() => setView("team")}
          >
            Team
          </button>
          <button
            className={`tab-btn ${view === "pipeline" ? "tab-btn-active" : ""}`}
            onClick={() => setView("pipeline")}
          >
            Pipeline
          </button>

          <div className="tab-dropdown">
            <button className="tab-btn">Directory ▾</button>
            <div className="tab-dropdown-menu">
              <div className="tab-dropdown-menu-card">
                <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory")}>All Companies</a>
                <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory?category=Contractor")}>Contractors</a>
                <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory?category=Customer")}>Customers</a>
                <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory?category=Engineering%20Firm")}>Engineering Firms</a>
                <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory/towers")}>Towers</a>
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "home" && (
        <div className="home-layout">
          <div className="calendar-container">
            <div className="calendar-weekday-header">
              {["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => (
                <div key={d} className="calendar-weekday">{d}</div>
              ))}
            </div>

            <div className="calendar-grid">
              {calendarDays.map(({ date, key, isToday }) => {
                const dayProjects = projectsByDay[key] || [];
                const isSelected = selectedCalendarDay === key;

                return (
                  <div
                    key={key}
                    className={`calendar-day ${isToday ? "calendar-day-today" : ""} ${isSelected ? "calendar-day-selected" : ""}`}
                    onClick={() => setSelectedCalendarDay(key)}
                  >
                    <div className="calendar-day-number">{date.getDate()}</div>
                    <div className="calendar-day-events">
                      {dayProjects.slice(0, 3).map(c => (
                        <div
                          key={c.id}
                          className="calendar-event-pill"
                          onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/project/${c.id}`); }}
                        >
                          {c.projectName || c.company}
                        </div>
                      ))}
                      {dayProjects.length > 3 && (
                        <div className="calendar-event-more">+{dayProjects.length - 3} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="calendar-side-panel">
            <div className="calendar-panel-header">
              <h3 className="modal-title" style={{ margin: 0 }}>{panelTitle}</h3>
              {selectedCalendarDay && (
                <button className="link-muted" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={() => setSelectedCalendarDay(null)}>
                  ← This Week
                </button>
              )}
            </div>

            {panelProjects.length === 0 && (
              <p className="private-note-hint">Nothing due.</p>
            )}

            {panelProjects.map(c => (
              <div
                key={c.id}
                className="calendar-panel-item"
                onClick={() => router.push(`/dashboard/project/${c.id}`)}
              >
                <div className="customer-name" style={{ fontSize: 14 }}>{c.projectName || c.company}</div>
                {c.company && c.projectName && c.projectName !== c.company && (
                  <div className="customer-meta">{c.company}</div>
                )}
                <div className="customer-dates">Due: {formatDate(c.nextCheckIn)}</div>
                {c.category && <span className="role-badge" style={{ marginTop: 4 }}>{c.category}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "personal" && (
        <>
          {/* ADD PROJECT BUTTON */}
          <div style={{ marginBottom: 20 }}>
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>ADD PROJECT</button>
          </div>

          {/* ADD MODAL */}
          {showAddModal && (
            <div className="modal-overlay">
              <div className="modal-card">
                <button className="modal-close" onClick={() => { clearForm(); setShowAddModal(false); }}>✕</button>

                <h3 className="modal-title">Add Project</h3>

                <input className="field" name="add-projectName" autoComplete="off" placeholder="Project Name" value={projectName} onChange={e => setProjectName(e.target.value)} />
                <CompanyContactFields
                  idPrefix="add-project"
                  companies={companies}
                  contacts={contacts}
                  companyValue={company}
                  contactValue={contact}
                  emailValue={email}
                  phoneValue={phone}
                  onCompanyChange={setCompany}
                  onContactChange={setContact}
                  onEmailChange={setEmail}
                  onPhoneChange={setPhone}
                />
                <select className="field" value={category} onChange={e => setCategory(e.target.value)}>
                  <option value="">Select category...</option>
                  {CATEGORY_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
                <input className="field" name="add-projectValue" autoComplete="off" placeholder="Project Value" value={projectValue} onChange={e => setProjectValue(e.target.value)} />
                <input className="field" type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} />
                <AddressAutocomplete name="add-projectAddress" placeholder="Project Address (required)" value={projectAddress} onChange={setProjectAddress} />
                <input className="field" name="add-notes" autoComplete="off" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />

                <h4 className="field-label" style={{ marginTop: 12 }}>Equipment & Site Details (optional)</h4>
                <input className="field" name="add-equipmentType" autoComplete="off" placeholder="Type of Equipment" value={equipmentType} onChange={e => setEquipmentType(e.target.value)} />
                <input className="field" name="add-towerManufacturer" autoComplete="off" placeholder="Tower Manufacturer" value={towerManufacturer} onChange={e => setTowerManufacturer(e.target.value)} />
                <input className="field" name="add-modelNumber" autoComplete="off" placeholder="Model Number" value={modelNumber} onChange={e => setModelNumber(e.target.value)} />
                <input className="field" name="add-serialNumber" autoComplete="off" placeholder="Serial Number" value={serialNumber} onChange={e => setSerialNumber(e.target.value)} />
                <div className="field-label">Year Installed</div>
                <input className="field" type="number" placeholder="YYYY" min="1900" max="2100" value={dateInstalled} onChange={e => setDateInstalled(e.target.value)} />

                <button className="btn btn-primary btn-block" onClick={addCustomer}>ADD</button>
              </div>
            </div>
          )}

          {/* SEARCH */}
          <div className="toolbar">
            <button className="btn btn-icon" onClick={() => setSearchOpen(!searchOpen)}>🔍</button>

            {searchOpen && (
              <input
                className="field"
                placeholder="Search project, company, contact, address, or notes..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ flex: 1 }}
              />
            )}
          </div>

          {/* LIST */}
          {filteredCustomers.map(c => {
            const days = diffDays(c.nextCheckIn);
            const isOwner = c.ownerId === uid;
            const pendingRequests = requestsById[c.id] || [];

            let barClass = "badge-bar-ok";
            if (days <= 0) barClass = "badge-bar-overdue";
            else if (days <= 2) barClass = "badge-bar-soon";

            return (
              <div
                key={c.id}
                className={`customer-card ${barClass}`}
                onClick={() => { if (editingId !== c.id) router.push(`/dashboard/project/${c.id}`); }}
                style={{ cursor: editingId === c.id ? "default" : "pointer" }}
              >

                {/* LEFT */}
                <div className="customer-card-left">
                  {!isOwner && <div className="owner-badge" style={{ marginBottom: 6 }}>🤝 Collaborating with {ownerLabel(c.ownerId)}</div>}
                  {editingId === c.id ? (
                    <>
                      <input className="field" name={`edit-projectName-${c.id}`} autoComplete="off" placeholder="Project Name" value={editData.projectName} onChange={e => setEditData({ ...editData, projectName: e.target.value })} />
                      <CompanyContactFields
                        idPrefix={`edit-project-${c.id}`}
                        companies={companies}
                        contacts={contacts}
                        companyValue={editData.company}
                        contactValue={editData.contact}
                        emailValue={editData.email}
                        phoneValue={editData.phone}
                        onCompanyChange={v => setEditData({ ...editData, company: v })}
                        onContactChange={v => setEditData({ ...editData, contact: v })}
                        onEmailChange={v => setEditData({ ...editData, email: v })}
                        onPhoneChange={v => setEditData({ ...editData, phone: v })}
                      />

                      <div className="field-label">Category</div>
                      <select className="field" value={editData.category} onChange={e => setEditData({ ...editData, category: e.target.value })}>
                        <option value="">Select category...</option>
                        {CATEGORY_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>

                      <div className="field-label">Next Date</div>
                      <input
                        className="field"
                        type="date"
                        value={editData.nextCheckIn}
                        onChange={e => setEditData({ ...editData, nextCheckIn: e.target.value })}
                      />

                      <div className="field-label">Last Contact</div>
                      <input
                        className="field"
                        type="date"
                        value={editData.lastContact}
                        onChange={e => setEditData({ ...editData, lastContact: e.target.value })}
                      />
                    </>
                  ) : (
                    <>
                      <div className="customer-name">{c.projectName || c.company}</div>
                      {c.company && (c.projectName && c.projectName !== c.company) && (
                        <div className="customer-contact">{c.company}</div>
                      )}

                      <div className="customer-contact">
                        {c.contact}
                      </div>

                      <div className="customer-meta">
                        {c.email || ""} | {formatPhone(c.phone)}
                      </div>

                      {c.category && <span className="role-badge" style={{ marginTop: 6 }}>{c.category}</span>}
                      {c.projectValue && <div className="customer-meta" style={{ marginTop: 4 }}>Value: {c.projectValue}</div>}

                      <div className="customer-dates">Next: {formatDate(c.nextCheckIn)}</div>
                      <div className="customer-dates">Last: {formatDate(c.lastContact)}</div>
                    </>
                  )}
                </div>

                {/* MIDDLE */}
                <div className="customer-card-middle customer-notes-preview" onClick={(e) => { e.stopPropagation(); openModal(c); }}>
                  <div>
                    {notesById[c.id]?.notes}
                  </div>

                  {isOwner && pendingRequests.length > 0 && (
                    <div className="collab-requests" onClick={(e) => e.stopPropagation()}>
                      {pendingRequests.map(r => (
                        <div key={r.id} className="collab-request-row">
                          <span>🤝 {r.requesterName} wants to collaborate</span>
                          <div className="collab-request-actions">
                            <button className="btn btn-secondary" onClick={() => approveRequest(c.id, r)}>Approve</button>
                            <button className="btn btn-danger" onClick={() => denyRequest(c.id, r)}>Deny</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {isOwner && (c.collaboratorIds || []).length > 0 && (
                    <div className="collab-requests" onClick={(e) => e.stopPropagation()}>
                      {c.collaboratorIds.map(collabId => (
                        <div key={collabId} className="collab-request-row">
                          <span>🤝 Collaborating with {ownerLabel(collabId)}</span>
                          <button className="btn btn-danger" onClick={() => revokeCollaborator(c.id, collabId)}>Revoke</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* RIGHT */}
                <div className="customer-card-right" onClick={(e) => e.stopPropagation()}>
                  {isOwner ? (
                    <>
                      <div className="checkbox-group">
                        <label>
                          <input type="checkbox" onChange={() => handleFollowUp(c)} />
                          Follow Up
                        </label>

                        <label>
                          <input type="checkbox" onChange={() => openCompletedPopup(c)} />
                          Completed
                        </label>
                      </div>

                      {editingId === c.id ? (
                        <>
                          <button className="btn btn-secondary" onClick={saveEdit}>Save</button>
                          <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                          <button className="btn btn-danger" onClick={() => deleteCustomer(c.id)}>
                            Delete
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-secondary" onClick={() => startEdit(c)}>Edit</button>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="private-note-hint">Notes only — owned by {ownerLabel(c.ownerId)}</span>
                      <button
                        className="btn btn-secondary"
                        onClick={(e) => { e.stopPropagation(); revokeCollaborator(c.id, uid); }}
                      >
                        Leave Collaboration
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {/* COMPLETED POPUP */}
          {completedTarget && (
            <div className="modal-overlay">
              <div className="modal-card">
                <h3 className="modal-title">Contact Method</h3>

                <select className="field" value={contactMethod} onChange={e => setContactMethod(e.target.value)}>
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                </select>

                <div className="modal-actions">
                  <button className="btn btn-primary" onClick={confirmCompleted}>Confirm</button>
                  <button className="btn btn-secondary" onClick={() => setCompletedTarget(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* MODAL */}
          {selected && (
            <div className="modal-overlay">
              <div className="modal-card modal-wide">
                <button className="modal-close" onClick={closeModal}>✕</button>

                <h2 className="modal-title">{selected.projectName || selected.company}</h2>
                {selected.company && (selected.projectName && selected.projectName !== selected.company) && (
                  <p className="modal-subtitle">{selected.company}</p>
                )}

                <p>{selected.contact}</p>
                <p>{selected.email}</p>
                <p>{selected.phone}</p>

                <h4 className="field-label">Notes</h4>
                {notesById[selected.id]?.notesAuthorName && (
                  <p className="private-note-hint">Last written by {notesById[selected.id].notesAuthorName}</p>
                )}
                <textarea
                  className="field"
                  name="modalNotes"
                  autoComplete="off"
                  style={{ width: "100%", height: 80 }}
                  value={modalNotes}
                  onChange={e => setModalNotes(e.target.value)}
                />

                <button className="btn btn-primary" onClick={saveModalNotes}>Save Notes</button>

                <h4 className="field-label">History</h4>
                {(notesById[selected.id]?.notesHistory || []).map((h, i) => (
                  <div key={i} className="notes-history-item notes-history-row">
                    <div>
                      <div>{h.text}</div>
                      <div className="notes-history-date">{h.authorName || "Unknown"} · {h.date}</div>
                    </div>
                    <button className="btn btn-danger" onClick={() => deleteHistoryEntry(selected.id, i)}>Delete</button>
                  </div>
                ))}
              </div>
            </div>
          )}

        </>
      )}

      {view === "team" && (
        <>
          <div className="toolbar">
            <button className="btn btn-icon" onClick={() => setSearchOpen(!searchOpen)}>🔍</button>

            {searchOpen && (
              <input
                className="field"
                placeholder="Search project, company, contact, address, or notes..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ flex: 1 }}
              />
            )}

            <select
              className="field"
              style={{ maxWidth: 220, marginLeft: "auto" }}
              value={teamFilterOwner}
              onChange={e => setTeamFilterOwner(e.target.value)}
            >
              <option value="all">All Team Members</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.id === uid ? "You" : (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email)}
                </option>
              ))}
            </select>
          </div>

          {teamCustomers.map(c => {
            const days = diffDays(c.nextCheckIn);
            const isOwner = c.ownerId === uid;
            const isCollaborator = (c.collaboratorIds || []).includes(uid);
            const hasRequested = requestedIds.has(c.id);

            let barClass = "badge-bar-ok";
            if (days <= 0) barClass = "badge-bar-overdue";
            else if (days <= 2) barClass = "badge-bar-soon";

            return (
              <div
                key={c.id}
                onClick={() => router.push(`/dashboard/project/${c.id}`)}
                className={`customer-card ${barClass}`}
                style={{ cursor: "pointer" }}
              >
                <div className="customer-card-left">
                  <div className="customer-name">{c.projectName || c.company}</div>
                  {c.company && (c.projectName && c.projectName !== c.company) && (
                    <div className="customer-contact">{c.company}</div>
                  )}
                  <div className="customer-contact">{c.contact}</div>
                  <div className="customer-meta">
                    {c.email || ""} | {formatPhone(c.phone)}
                  </div>
                  {c.category && <span className="role-badge" style={{ marginTop: 6 }}>{c.category}</span>}
                  {c.projectValue && <div className="customer-meta" style={{ marginTop: 4 }}>Value: {c.projectValue}</div>}
                  <div className="customer-dates">Next: {formatDate(c.nextCheckIn)}</div>
                  <div className="customer-dates">Last: {formatDate(c.lastContact)}</div>
                </div>

                <div className="customer-card-middle">
                  <div className="owner-badge">Owned by {ownerLabel(c.ownerId)}</div>
                  {isCollaborator ? (
                    <div className="private-note-hint">🤝 You're collaborating on this entry</div>
                  ) : role === "admin" ? (
                    <div className="private-note-hint">Notes visible to you as admin</div>
                  ) : (
                    <div className="private-note-hint">🔒 Notes are private to {ownerLabel(c.ownerId)}</div>
                  )}
                </div>

                <div className="customer-card-right">
                  {!isOwner && !isCollaborator && (
                    <button
                      className="btn btn-secondary"
                      disabled={hasRequested}
                      onClick={(e) => { e.stopPropagation(); requestCollaborate(c); }}
                    >
                      {hasRequested ? "Requested" : "Request to Collaborate"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

        </>
      )}

      {view === "pipeline" && (
        <>
          <div style={{ marginBottom: 20, display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn btn-primary" onClick={() => setShowAddPipelineModal(true)}>ADD PIPELINE ENTRY</button>

            <select
              className="field"
              style={{ maxWidth: 220, marginLeft: "auto", marginBottom: 0 }}
              value={pipelineFilterOwner}
              onChange={e => setPipelineFilterOwner(e.target.value)}
            >
              <option value="all">All Team Members</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.id === uid ? "You" : (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email)}
                </option>
              ))}
            </select>
          </div>

          {showAddPipelineModal && (
            <div className="modal-overlay">
              <div className="modal-card modal-extra-wide">
                <button className="modal-close" onClick={() => { clearPipelineForm(); setShowAddPipelineModal(false); }}>✕</button>

                <h3 className="modal-title">Add Pipeline Entry</h3>

                <input className="field" name="pipeline-title" autoComplete="off" placeholder="Project / Opportunity Name" value={pipelineTitle} onChange={e => setPipelineTitle(e.target.value)} />

                <div className="form-grid-2">
                  <div>
                    <label className="field-label">Stage</label>
                    <select className="field" value={pipelineStage} onChange={e => setPipelineStage(e.target.value)}>
                      {PIPELINE_STAGE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Bid Date</label>
                    <input className="field" type="date" value={pipelineBidDate} onChange={e => setPipelineBidDate(e.target.value)} />
                  </div>

                  <div>
                    <label className="field-label">Estimated Value</label>
                    <input className="field" name="pipeline-value" autoComplete="off" value={pipelineValue} onChange={e => setPipelineValue(e.target.value)} />
                  </div>

                  <CompanyContactFields
                    idPrefix="add-pipeline"
                    companies={companies}
                    contacts={contacts}
                    companyLabel="Engineering Firm"
                    companyValue={pipelineCompany}
                    contactValue={pipelineContact}
                    emailValue={pipelineEmail}
                    phoneValue={pipelinePhone}
                    onCompanyChange={setPipelineCompany}
                    onContactChange={setPipelineContact}
                    onEmailChange={setPipelineEmail}
                    onPhoneChange={setPipelinePhone}
                  />
                </div>

                <h4 className="field-label" style={{ marginTop: 12 }}>Contractors Bidding (optional)</h4>
                {biddingCompanies.map((row, i) => (
                  <div key={i} className="bidding-company-row">
                    <CompanyContactFields
                      idPrefix={`add-pipeline-bidder-${i}`}
                      companies={companies}
                      contacts={contacts}
                      companyLabel="Contractor"
                      companyValue={row.company}
                      contactValue={row.contact}
                      emailValue={row.email}
                      phoneValue={row.phone}
                      onCompanyChange={v => updateBiddingCompanyRow(i, "company", v)}
                      onContactChange={v => updateBiddingCompanyRow(i, "contact", v)}
                      onEmailChange={v => updateBiddingCompanyRow(i, "email", v)}
                      onPhoneChange={v => updateBiddingCompanyRow(i, "phone", v)}
                    />
                    <button className="btn btn-danger" onClick={() => removeBiddingCompanyRow(i)}>Remove</button>
                  </div>
                ))}
                <button className="btn btn-secondary" onClick={addBiddingCompanyRow}>+ Add Contractor</button>

                <h4 className="field-label" style={{ marginTop: 12 }}>Tower Details (optional)</h4>
                <div className="form-grid-2">
                  <input className="field" name="add-pipeline-towerManufacturer" autoComplete="off" placeholder="Tower Manufacturer" value={pipelineTowerManufacturer} onChange={e => setPipelineTowerManufacturer(e.target.value)} />
                  <input className="field" name="add-pipeline-modelNumber" autoComplete="off" placeholder="Model Number" value={pipelineModelNumber} onChange={e => setPipelineModelNumber(e.target.value)} />
                  <input className="field" name="add-pipeline-serialNumber" autoComplete="off" placeholder="Serial Number" value={pipelineSerialNumber} onChange={e => setPipelineSerialNumber(e.target.value)} />
                </div>

                <h4 className="field-label" style={{ marginTop: 12 }}>Notes</h4>
                <input className="field" name="pipeline-notes" autoComplete="off" placeholder="Notes" value={pipelineNotes} onChange={e => setPipelineNotes(e.target.value)} />

                <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={addPipelineEntry}>ADD</button>
              </div>
            </div>
          )}

          {filteredPipeline.map(p => (
            <div
              key={p.id}
              className="customer-card"
              onClick={() => router.push(`/dashboard/pipeline/${p.id}`)}
              style={{ cursor: "pointer" }}
            >
              <div className="customer-card-left">
                <div className="customer-name">{p.title}</div>
                {p.company && <div className="customer-contact">{p.company}</div>}
                {p.contact && <div className="customer-meta">{p.contact}</div>}
                <span className="role-badge role-badge-admin" style={{ marginTop: 6 }}>{p.stage}</span>
                {p.value && <div className="customer-meta" style={{ marginTop: 4 }}>Value: {p.value}</div>}
              </div>

              <div className="customer-card-middle">
                <div className="owner-badge">Owned by {ownerLabel(p.ownerId)}</div>
                {p.bidDate && <div className="customer-dates">Bid Date: {p.bidDate}</div>}
                {(p.biddingCompanies || []).length > 0 && (
                  <div className="private-note-hint">
                    {p.biddingCompanies.length} contractor{p.biddingCompanies.length === 1 ? "" : "s"} bidding
                  </div>
                )}
                {p.convertedToProjectId && (
                  <div className="private-note-hint" style={{ marginTop: 4 }}>✅ Converted to project</div>
                )}
              </div>

              <div className="customer-card-right" onClick={(e) => e.stopPropagation()}>
                {p.ownerId !== uid && <span className="private-note-hint">View only</span>}
              </div>
            </div>
          ))}

          {filteredPipeline.length === 0 && (
            <p className="private-note-hint">No pipeline entries yet.</p>
          )}
        </>
      )}

      {view === "admin" && (
        <div className="admin-panel">
          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700 }}>Settings</h2>
          <p className="modal-subtitle" style={{ marginBottom: 16 }}>
            Company account management — create logins and control access.
          </p>

          <div className="admin-card">
            <h3 className="modal-title">Create Account</h3>

            <label className="field-label">First Name (optional)</label>
            <input
              className="field"
              name="newUserFirstName"
              autoComplete="off"
              placeholder="First name"
              value={newUserFirstName}
              onChange={e => setNewUserFirstName(e.target.value)}
            />

            <label className="field-label">Last Name (optional)</label>
            <input
              className="field"
              name="newUserLastName"
              autoComplete="off"
              placeholder="Last name"
              value={newUserLastName}
              onChange={e => setNewUserLastName(e.target.value)}
            />

            <label className="field-label">Email</label>
            <input
              className="field"
              name="newUserEmail"
              autoComplete="off"
              placeholder="name@company.com"
              value={newUserEmail}
              onChange={e => setNewUserEmail(e.target.value)}
            />

            <label className="field-label">Role</label>
            <select className="field" value={newUserRole} onChange={e => setNewUserRole(e.target.value)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>

            <button className="btn btn-primary" onClick={createUser}>Create Account</button>
            <p className="modal-subtitle" style={{ marginTop: 10 }}>
              They'll get an email to set their own password.
              {(!newUserFirstName || !newUserLastName) && " If you skip the name fields, they'll be asked for it on first login."}
            </p>
          </div>

          <div className="admin-card">
            <h3 className="modal-title">Team Members</h3>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td>
                        {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : (
                          <span className="private-note-hint">Not set yet</span>
                        )}
                      </td>
                      <td>{u.email}{u.id === uid ? " (You)" : ""}</td>
                      <td>
                        <span className={`role-badge ${u.role === "admin" ? "role-badge-admin" : ""}`}>
                          {u.role}
                        </span>
                      </td>
                      <td>{u.disabled ? "Disabled" : "Active"}</td>
                      <td className="admin-table-actions">
                        {u.id === uid ? (
                          <span className="private-note-hint">Manage your own account from another admin's login.</span>
                        ) : (
                          <>
                            <button className="btn btn-secondary" onClick={() => toggleUserRole(u)}>
                              Make {u.role === "admin" ? "Member" : "Admin"}
                            </button>
                            <button className="btn btn-danger" onClick={() => toggleUserDisabled(u)}>
                              {u.disabled ? "Reactivate" : "Deactivate"}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
