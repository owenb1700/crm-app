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
  arrayRemove,
  query,
  where
} from "firebase/firestore";
import { ensureCompanyAndContact, ensureCompanyAndContactBatch } from "../../lib/directory";
import { ensureTowerModel } from "../../lib/towerModels";
import CompanyContactFields from "../components/CompanyContactFields";
import AddressAutocomplete from "../components/AddressAutocomplete";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const CATEGORY_OPTIONS = ["Pre-Bid", "Bidding", "Prospecting", "Ongoing Project", "Order", "Parts", "Project Closed"];
const PIPELINE_STAGE_OPTIONS = ["Pre-Bid", "Bidding", "Design", "Budgeting"];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULT_DIGEST_SCHEDULE = { dayOfWeek: 0, daysAhead: 7, includeOverdue: true };

// "member" and "estimating" are stored as-is in Firestore (estimating has
// identical permissions to member for now, just a distinct label/identity)
// -- only the displayed text changes.
const ROLE_LABELS = { admin: "Admin", member: "Salesperson", estimating: "Estimating Department" };
const roleLabel = (role) => ROLE_LABELS[role] || role;

// Per-user feature access, set at account creation and editable anytime
// from Settings -> Team Members. Admins always have every permission
// regardless of this map. Anyone created before this existed (or with no
// permissions field at all) defaults to everything on, so nothing changes
// until an admin deliberately restricts something.
const PERMISSION_DEFS = [
  { key: "dashboard", label: "Home & My Dashboard" },
  { key: "team", label: "Team" },
  { key: "pipeline", label: "Pipeline" },
  { key: "directory", label: "Directory (Companies & Contacts)" },
  { key: "towers", label: "Towers & Tower Models" },
  { key: "products", label: "Products" }
];
const DEFAULT_PERMISSIONS = PERMISSION_DEFS.reduce((acc, p) => ({ ...acc, [p.key]: true }), {});

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
  const [notifications, setNotifications] = useState([]);
  const [notificationsError, setNotificationsError] = useState(null);
  const [showAlertsPanel, setShowAlertsPanel] = useState(false);
  const [digestSchedules, setDigestSchedules] = useState([]);
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
  const [rebuildingDirectory, setRebuildingDirectory] = useState(false);

  // COLLABORATION
  const [requestsById, setRequestsById] = useState({}); // customerId -> pending requests on entries I own
  const [requestedIds, setRequestedIds] = useState(new Set()); // customerIds I've just requested (optimistic)
  const [teamFilterOwner, setTeamFilterOwner] = useState("all");

  // PIPELINE FORM
  const [pipelineTitle, setPipelineTitle] = useState("");
  const [pipelineStage, setPipelineStage] = useState("Pre-Bid");
  const [pipelineBidDate, setPipelineBidDate] = useState("");
  const [pipelineValue, setPipelineValue] = useState("");
  const [pipelineCompany, setPipelineCompany] = useState("");
  const [pipelineContact, setPipelineContact] = useState("");
  const [pipelineEmail, setPipelineEmail] = useState("");
  const [pipelinePhone, setPipelinePhone] = useState("");
  const [pipelineProjectAddress, setPipelineProjectAddress] = useState("");
  const [pipelineNotes, setPipelineNotes] = useState("");
  const [pipelineTowerManufacturer, setPipelineTowerManufacturer] = useState("");
  const [pipelineModelNumber, setPipelineModelNumber] = useState("");
  const [pipelineSerialNumber, setPipelineSerialNumber] = useState("");
  const [pipelineSalespersonId, setPipelineSalespersonId] = useState("");
  const [pipelineProjectPointPersonId, setPipelineProjectPointPersonId] = useState("");
  const [biddingCompanies, setBiddingCompanies] = useState([]);
  const [showAddPipelineModal, setShowAddPipelineModal] = useState(false);

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
  const [pastProjectsSearch, setPastProjectsSearch] = useState("");
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");

  // ADMIN: create user form
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("member");
  const [newUserFirstName, setNewUserFirstName] = useState("");
  const [newUserLastName, setNewUserLastName] = useState("");
  const [newUserPermissions, setNewUserPermissions] = useState(DEFAULT_PERMISSIONS);
  const [editPermissionsTarget, setEditPermissionsTarget] = useState(null);
  const [editPermissionsData, setEditPermissionsData] = useState(DEFAULT_PERMISSIONS);

  const col = collection(db, "customers");

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 5000);
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

  // The Directory only fills in as a side effect of saving a project or
  // pipeline entry, so anything created before that feature existed (or
  // untouched since) never made it into companies/contacts/towerModels.
  // This walks every existing project + pipeline entry and backfills them,
  // reusing the exact same capture logic as a normal save. Safe to re-run
  // any time -- it just skips anything that already exists.
  const rebuildDirectory = async () => {
    if (!window.confirm("Rebuild the Directory from every existing project and pipeline entry? This can take a minute for a lot of data.")) return;

    setRebuildingDirectory(true);
    try {
      const captureEntries = [];

      customers.forEach(c => {
        captureEntries.push({
          companyName: c.company, category: "Contractor",
          contactName: c.contact, email: c.email, phone: c.phone
        });
      });

      pipelineEntries.forEach(p => {
        captureEntries.push({
          companyName: p.company, category: "Engineering Firm",
          contactName: p.contact, email: p.email, phone: p.phone
        });
        (p.biddingCompanies || []).forEach(b => {
          captureEntries.push({
            companyName: b.company, category: "Contractor",
            contactName: b.contact, email: b.email, phone: b.phone
          });
        });
      });

      await ensureCompanyAndContactBatch(captureEntries, { companies, contacts, uid });

      const workingTowerModels = [...towerModels];
      const towerEntries = [
        ...customers.map(c => ({ manufacturer: c.towerManufacturer, model: c.modelNumber })),
        ...pipelineEntries.map(p => ({ manufacturer: p.towerManufacturer, model: p.modelNumber }))
      ];
      for (const entry of towerEntries) {
        const result = await ensureTowerModel({ towerModels: workingTowerModels, manufacturer: entry.manufacturer, model: entry.model, uid });
        if (result && !workingTowerModels.some(t => t.id === result.id)) {
          workingTowerModels.push(result);
        }
      }

      await loadDirectory();
      await loadTowerModels();
      showToast("Directory rebuilt from existing projects & pipeline");
    } finally {
      setRebuildingDirectory(false);
    }
  };

  // One-time correction: the Project "Company" field used to auto-capture
  // into the Directory under the "Customer" category, but it's actually
  // always been the contractor a project runs through, not the end
  // customer -- so every company that landed under "Customer" this way
  // needs to move to "Contractor". Safe to re-run; it's a no-op once
  // there's nothing left categorized as Customer.
  const [fixingContractorCategories, setFixingContractorCategories] = useState(false);

  const fixContractorCategories = async () => {
    setFixingContractorCategories(true);
    try {
      const toFix = companies.filter(c => c.category === "Customer");
      await Promise.all(toFix.map(c => updateDoc(doc(db, "companies", c.id), { category: "Contractor" })));
      await loadDirectory();
      showToast(`Recategorized ${toFix.length} compan${toFix.length === 1 ? "y" : "ies"} to Contractor`);
    } finally {
      setFixingContractorCategories(false);
    }
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

  const loadNotifications = async (currentUid) => {
    const snap = await getDocs(query(collection(db, "notifications"), where("userId", "==", currentUid)));
    const list = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    setNotifications(list);
    setNotificationsError(null);
  };

  // In-app alert, independent of whether the accompanying email actually
  // gets delivered -- the alerts bell always shows what happened even
  // when email doesn't (see: the whole SES/Gmail saga).
  const notifyUser = async (userId, { type, message, link, email, subject, emailHtml, emailPref }) => {
    await addDoc(collection(db, "notifications"), {
      userId,
      type,
      message,
      link: link || null,
      read: false,
      createdAt: new Date().toISOString()
    });

    if (email && emailPref !== false) {
      sendNotificationEmail(email, subject, emailHtml);
    }
  };

  const markNotificationRead = async (n) => {
    if (!n.read) {
      await updateDoc(doc(db, "notifications", n.id), { read: true });
      setNotifications(prev => prev.map(x => (x.id === n.id ? { ...x, read: true } : x)));
    }
  };

  const markAllNotificationsRead = async () => {
    const unread = notifications.filter(n => !n.read);
    await Promise.all(unread.map(n => updateDoc(doc(db, "notifications", n.id), { read: true })));
    setNotifications(prev => prev.map(x => ({ ...x, read: true })));
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
    if (owner) {
      notifyUser(owner.id, {
        type: "collab_request",
        message: `${requesterName} wants to collaborate on ${projectLabel}`,
        link: `/dashboard/project/${c.id}`,
        email: owner.email,
        subject: `${requesterName} wants to collaborate on ${projectLabel}`,
        emailHtml: `<p>${requesterName} has requested to collaborate on <strong>${projectLabel}</strong>. Log in to your CRM dashboard to approve or deny.</p>`,
        emailPref: owner.notifyCollabRequest
      });
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
    if (requester) {
      notifyUser(requester.id, {
        type: "collab_approved",
        message: `Your request to collaborate on ${projectLabel} was approved`,
        link: `/dashboard/project/${customerId}`,
        email: requester.email,
        subject: `You can now collaborate on ${projectLabel}`,
        emailHtml: `<p>Your request to collaborate on <strong>${projectLabel}</strong> was approved. It now shows up in your My Dashboard.</p>`,
        emailPref: requester.notifyCollabApproved
      });
    }

    loadCustomers(uid, role === "admin");
  };

  const denyRequest = async (customerId, request) => {
    if (!window.confirm(`Deny ${request.requesterName}'s request to collaborate?`)) return;
    await deleteDoc(doc(db, "customers", customerId, "collabRequests", request.id));
    showToast("Request denied");

    const c = customers.find(c => c.id === customerId);
    const projectLabel = c?.projectName || c?.company || "an entry";
    notifyUser(request.requesterId, {
      type: "collab_denied",
      message: `Your request to collaborate on ${projectLabel} was denied`,
      link: null
    });

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

  const addDigestSchedule = () => {
    setDigestSchedules(prev => [...prev, { ...DEFAULT_DIGEST_SCHEDULE }]);
  };

  const updateDigestSchedule = (index, field, value) => {
    setDigestSchedules(prev => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };

  const removeDigestSchedule = (index) => {
    setDigestSchedules(prev => prev.filter((_, i) => i !== index));
  };

  const saveNotificationSettings = async () => {
    await updateDoc(doc(db, "users", uid), {
      digestSchedules,
      notifyCollabRequest,
      notifyCollabApproved
    });
    setMyProfile(prev => ({ ...(prev || {}), digestSchedules, notifyCollabRequest, notifyCollabApproved }));
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

          // Carry forward whoever was on the old fixed Sunday/Wednesday
          // digests into the equivalent custom schedules the first time
          // they load this after the rework, so no one silently stops
          // getting emails they were relying on. Once they hit Save here,
          // digestSchedules is written and this fallback no longer applies.
          if (profile.digestSchedules) {
            setDigestSchedules(profile.digestSchedules);
          } else {
            const carried = [];
            if (profile.notifySundayDigest !== false) carried.push({ dayOfWeek: 0, daysAhead: 7, includeOverdue: true });
            if (profile.notifyWednesdayDigest !== false) carried.push({ dayOfWeek: 3, daysAhead: 5, includeOverdue: true });
            setDigestSchedules(carried);
          }

          setNotifyCollabRequest(profile.notifyCollabRequest !== false);
          setNotifyCollabApproved(profile.notifyCollabApproved !== false);
          await loadCustomers(user.uid, profile.role === "admin");
          await loadPipeline();
          await loadDirectory();
          await loadTowerModels();
          // A broken alerts bell shouldn't take down the whole dashboard,
          // but the failure still needs to be visible -- an empty list
          // must never be indistinguishable from "nothing to show."
          try {
            await loadNotifications(user.uid);
          } catch (err) {
            setNotificationsError(err.message || "Couldn't load alerts.");
          }
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

  // If the current view is one this user's permissions don't allow (e.g.
  // an admin just revoked it, or it's their first load after being
  // restricted), bounce to the first tab they still have. Past Projects
  // is always available so it's the guaranteed fallback.
  useEffect(() => {
    if (!myProfile) return;
    const perms = role === "admin"
      ? PERMISSION_DEFS.reduce((acc, p) => ({ ...acc, [p.key]: true }), {})
      : { ...DEFAULT_PERMISSIONS, ...(myProfile?.permissions || {}) };
    const viewPermissionMap = { home: "dashboard", personal: "dashboard", team: "team", pipeline: "pipeline" };
    const neededPerm = viewPermissionMap[view];
    if (neededPerm && !perms[neededPerm]) {
      if (perms.dashboard) setView("home");
      else if (perms.team) setView("team");
      else if (perms.pipeline) setView("pipeline");
      else setView("pastProjects");
    }
  }, [myProfile, role, view]);

  // ADD
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
    setPipelineProjectAddress("");
    setPipelineNotes("");
    setBiddingCompanies([]);
    setPipelineTowerManufacturer("");
    setPipelineModelNumber("");
    setPipelineSerialNumber("");
    setPipelineSalespersonId("");
    setPipelineProjectPointPersonId("");
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
      projectAddress: pipelineProjectAddress || null,
      biddingCompanies: biddingCompanies.filter(r => r.company || r.contact),
      towerManufacturer: pipelineTowerManufacturer || null,
      modelNumber: pipelineModelNumber || null,
      serialNumber: pipelineSerialNumber || null,
      salespersonId: pipelineSalespersonId || null,
      projectPointPersonId: pipelineProjectPointPersonId || null,
      trackedByIds: [],
      outcome: null,
      wonByContractor: null,
      nextCheckIn: null,
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
    const original = customers.find(c => c.id === editingId);
    const payload = { ...editData };

    // Closing a project schedules a 1-year "how are things going" check-in
    // automatically, so it resurfaces on the Home calendar even though it's
    // now hidden from the active My Dashboard list.
    if (editData.category === "Project Closed" && original?.category !== "Project Closed") {
      const followUp = new Date();
      followUp.setFullYear(followUp.getFullYear() + 1);
      payload.nextCheckIn = adjustWeekend(followUp.toISOString());
    }

    await updateDoc(doc(db, "customers", editingId), payload);

    ensureCompanyAndContact({
      companies, contacts, companyName: editData.company, category: "Contractor",
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

  const snoozeClosedFollowUp = async (c) => {
    const next = new Date();
    next.setMonth(next.getMonth() + 3);

    await updateDoc(doc(db, "customers", c.id), {
      nextCheckIn: adjustWeekend(next.toISOString())
    });

    showToast("Snoozed for 3 months");
    loadCustomers(uid, role === "admin");
  };

  const followUpAnotherYear = async (c) => {
    const next = new Date();
    next.setFullYear(next.getFullYear() + 1);

    await updateDoc(doc(db, "customers", c.id), {
      nextCheckIn: adjustWeekend(next.toISOString())
    });

    showToast("Follow-up scheduled for 1 year");
    loadCustomers(uid, role === "admin");
  };

  // Same snooze/re-follow-up pattern as closed projects, but for Won
  // pipeline entries -- lost entries never get a nextCheckIn in the first
  // place, so there's nothing to follow up on for those.
  const snoozePipelineFollowUp = async (p) => {
    const next = new Date();
    next.setMonth(next.getMonth() + 3);

    await updateDoc(doc(db, "pipeline", p.id), {
      nextCheckIn: adjustWeekend(next.toISOString())
    });

    showToast("Snoozed for 3 months");
    loadPipeline();
  };

  const pipelineFollowUpAnotherYear = async (p) => {
    const next = new Date();
    next.setFullYear(next.getFullYear() + 1);

    await updateDoc(doc(db, "pipeline", p.id), {
      nextCheckIn: adjustWeekend(next.toISOString())
    });

    showToast("Follow-up scheduled for 1 year");
    loadPipeline();
  };

  const openCompletedPopup = (c) => {
    setCompletedTarget(c);
  };

  const confirmCompleted = async () => {
    // Marking a project completed closes it out the same way changing its
    // category to "Project Closed" does: it drops off My Dashboard, moves
    // into Past Projects, and gets the same 1-year follow-up (with the
    // same Snooze 3 Months / Follow Up in 1 Year options once due) as
    // every other closed project -- one unified process either way.
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);

    const entry = {
      type: "completed",
      method: contactMethod,
      timestamp: new Date().toISOString()
    };

    await updateDoc(doc(db, "customers", completedTarget.id), {
      category: "Project Closed",
      nextCheckIn: adjustWeekend(d.toISOString()),
      activityLog: [
        ...(completedTarget.activityLog || []),
        entry
      ]
    });

    setCompletedTarget(null);
    setContactMethod("phone");

    showToast("Marked completed — moved to Past Projects");
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
    let list = customers.filter(c =>
      (c.ownerId === uid || (c.collaboratorIds || []).includes(uid)) &&
      c.category !== "Project Closed"
    );
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

  // Pipeline entries "on my dashboard" -- owner, assigned salesperson,
  // assigned project point person, or self-tracked. Pulled live from the
  // same pipelineEntries used by the Pipeline tab, so it's always a
  // mirror of the single underlying document, never a copy.
  const myPipelineEntries = useMemo(() => {
    return pipelineEntries
      .filter(p =>
        p.ownerId === uid ||
        p.salespersonId === uid ||
        p.projectPointPersonId === uid ||
        (p.trackedByIds || []).includes(uid)
      )
      .filter(p => !p.convertedToProjectId && !p.outcome)
      .sort((a, b) => (a.bidDate || "").localeCompare(b.bidDate || ""));
  }, [pipelineEntries, uid]);

  // PAST PROJECTS: the company-wide archive of finished work -- closed
  // projects and resolved (Won/Lost) pipeline entries, for everyone to
  // browse regardless of who owned them.
  const pastProjectsList = useMemo(() => {
    let list = customers.filter(c => c.category === "Project Closed");
    if (pastProjectsSearch.trim()) {
      const q = pastProjectsSearch.toLowerCase();
      list = list.filter(c =>
        (c.projectName || "").toLowerCase().includes(q) ||
        (c.company || "").toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => (a.projectName || "").localeCompare(b.projectName || ""));
  }, [customers, pastProjectsSearch]);

  const pastPipelineList = useMemo(() => {
    let list = pipelineEntries.filter(p => p.outcome === "Won" || p.outcome === "Lost");
    if (pastProjectsSearch.trim()) {
      const q = pastProjectsSearch.toLowerCase();
      list = list.filter(p =>
        (p.title || "").toLowerCase().includes(q) ||
        (p.company || "").toLowerCase().includes(q) ||
        (p.wonByContractor || "").toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => (b.resolvedAt || "").localeCompare(a.resolvedAt || ""));
  }, [pipelineEntries, pastProjectsSearch]);

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
    let list = pipelineEntries.filter(p => !p.outcome);

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
    const projectItems = customers
      .filter(c => c.ownerId === uid || (c.collaboratorIds || []).includes(uid))
      .map(c => ({ ...c, _kind: "project" }));

    // Won pipeline entries follow up with whoever's actually responsible
    // for the relationship -- the assigned point person, falling back to
    // the salesperson, falling back to whoever owns the entry. Lost
    // entries never get a nextCheckIn set, so they never appear here.
    const pipelineFollowUps = pipelineEntries
      .filter(p => p.outcome === "Won" && p.nextCheckIn)
      .filter(p => (p.projectPointPersonId || p.salespersonId || p.ownerId) === uid)
      .map(p => ({ ...p, _kind: "pipeline", projectName: p.title }));

    return [...projectItems, ...pipelineFollowUps];
  }, [customers, pipelineEntries, uid]);

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
        permissions: newUserPermissions,
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
      setNewUserPermissions(DEFAULT_PERMISSIONS);
      showToast("Account created — setup email + SES verification email sent");
      loadUsers();
    } catch (err) {
      alert(err.message || "Could not create account");
    }
  };

  const changeUserRole = async (u, newRole) => {
    if (u.id === uid) {
      return alert("You can't change your own role. Ask another admin to do it.");
    }
    await updateDoc(doc(db, "users", u.id), { role: newRole });
    loadUsers();
  };

  const openEditPermissions = (u) => {
    setEditPermissionsTarget(u);
    setEditPermissionsData({ ...DEFAULT_PERMISSIONS, ...(u.permissions || {}) });
  };

  const savePermissions = async () => {
    await updateDoc(doc(db, "users", editPermissionsTarget.id), { permissions: editPermissionsData });
    setEditPermissionsTarget(null);
    showToast("Permissions updated");
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

  const myPermissions = role === "admin"
    ? PERMISSION_DEFS.reduce((acc, p) => ({ ...acc, [p.key]: true }), {})
    : { ...DEFAULT_PERMISSIONS, ...(myProfile?.permissions || {}) };

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

  const allPendingRequests = Object.entries(requestsById).flatMap(([customerId, reqs]) =>
    reqs.map(r => ({ ...r, customerId }))
  );
  const unreadNotificationCount = notifications.filter(n => !n.read).length;
  const alertsCount = allPendingRequests.length + unreadNotificationCount;

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
              {view === "admin" ? "Back to Dashboard" : "Admin Settings"}
            </button>
          )}

          <div className="alerts-menu">
            <button className="avatar-circle" style={{ position: "relative" }} onClick={() => setShowAlertsPanel(prev => !prev)}>
              🔔
              {alertsCount > 0 && <span className="alerts-badge">{alertsCount}</span>}
            </button>
            {showAlertsPanel && (
              <div className="alerts-dropdown">
                <div className="avatar-dropdown-card" style={{ width: 340 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <h4 className="field-label" style={{ margin: 0 }}>Alerts</h4>
                    {unreadNotificationCount > 0 && (
                      <button className="link-muted" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={markAllNotificationsRead}>
                        Mark all read
                      </button>
                    )}
                  </div>

                  {allPendingRequests.length > 0 && (
                    <>
                      <div className="field-label" style={{ marginTop: 8 }}>Pending Collaboration Requests</div>
                      {allPendingRequests.map(r => {
                        const c = customers.find(cust => cust.id === r.customerId);
                        const label = c?.projectName || c?.company || "an entry";
                        return (
                          <div key={`${r.customerId}-${r.id}`} className="notes-history-item" style={{ marginTop: 6 }}>
                            <div>
                              <strong>{r.requesterName}</strong> wants to collaborate on {label}
                            </div>
                            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                              <button className="btn btn-primary" onClick={() => approveRequest(r.customerId, r)}>Approve</button>
                              <button className="btn btn-secondary" onClick={() => denyRequest(r.customerId, r)}>Deny</button>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}

                  <div className="field-label" style={{ marginTop: 12 }}>Notifications</div>
                  {notificationsError && (
                    <p className="private-note-hint" style={{ color: "#dc2626" }}>⚠ Couldn't load alerts: {notificationsError}</p>
                  )}
                  {!notificationsError && notifications.length === 0 && (
                    <p className="private-note-hint">Nothing yet.</p>
                  )}
                  <div style={{ maxHeight: 280, overflowY: "auto" }}>
                    {notifications.map(n => (
                      <div
                        key={n.id}
                        className="notes-history-item"
                        style={{ marginTop: 6, cursor: n.link ? "pointer" : "default", opacity: n.read ? 0.6 : 1 }}
                        onClick={() => {
                          markNotificationRead(n);
                          if (n.link) {
                            setShowAlertsPanel(false);
                            router.push(n.link);
                          }
                        }}
                      >
                        <div>{n.message}</div>
                        <div className="notes-history-date">{(n.createdAt || "").slice(0, 16).replace("T", " ")}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

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
                  <span className={`role-badge ${role === "admin" ? "role-badge-admin" : ""}`}>{roleLabel(role)}</span>
                </div>
                <button className="btn btn-secondary btn-block" onClick={() => setShowUserSettings(true)}>
                  User Settings
                </button>
                <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={logout}>
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showUserSettings && (
        <div className="modal-overlay">
          <div className="modal-card">
            <button className="modal-close" onClick={() => setShowUserSettings(false)}>✕</button>
            <h3 className="modal-title">User Settings</h3>

            <h4 className="field-label" style={{ marginTop: 4 }}>Digest Emails</h4>
            <p className="private-note-hint">Each one sends at 4:00 AM Central on the day you pick.</p>

            {digestSchedules.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <select
                  className="field"
                  style={{ marginBottom: 0, width: 130 }}
                  value={s.dayOfWeek}
                  onChange={e => updateDigestSchedule(i, "dayOfWeek", Number(e.target.value))}
                >
                  {DAY_NAMES.map((d, idx) => <option key={idx} value={idx}>{d}</option>)}
                </select>
                <span style={{ fontSize: 13 }}>next</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  className="field"
                  style={{ marginBottom: 0, width: 60 }}
                  value={s.daysAhead}
                  onChange={e => updateDigestSchedule(i, "daysAhead", Number(e.target.value) || 1)}
                />
                <span style={{ fontSize: 13 }}>days</span>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={s.includeOverdue !== false}
                    onChange={e => updateDigestSchedule(i, "includeOverdue", e.target.checked)}
                  />
                  Include overdue
                </label>
                <button type="button" className="btn btn-secondary" onClick={() => removeDigestSchedule(i)}>×</button>
              </div>
            ))}

            {digestSchedules.length === 0 && (
              <p className="private-note-hint" style={{ marginTop: 8 }}>No digest emails scheduled.</p>
            )}

            <button
              type="button"
              className="link-muted"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 10, fontSize: 13 }}
              onClick={addDigestSchedule}
            >
              + Add another schedule
            </button>

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
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
          {myPermissions.dashboard && (
            <>
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
            </>
          )}
          {myPermissions.pipeline && (
            <button
              className={`tab-btn ${view === "pipeline" ? "tab-btn-active" : ""}`}
              onClick={() => setView("pipeline")}
            >
              Pipeline
            </button>
          )}

          {(myPermissions.directory || myPermissions.towers || myPermissions.products) && (
            <div className="tab-dropdown">
              <button className="tab-btn">Directory ▾</button>
              <div className="tab-dropdown-menu">
                <div className="tab-dropdown-menu-card">
                  {myPermissions.directory && (
                    <>
                      <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory")}>All Companies</a>
                      <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory?category=Contractor")}>Contractors</a>
                      <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory?category=Engineering%20Firm")}>Engineering Firms</a>
                    </>
                  )}
                  {myPermissions.towers && (
                    <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory/towers")}>Towers</a>
                  )}
                  {myPermissions.products && (
                    <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory/products")}>Products</a>
                  )}
                </div>
              </div>
            </div>
          )}

          {myPermissions.team && (
            <button
              className={`tab-btn ${view === "team" ? "tab-btn-active" : ""}`}
              onClick={() => setView("team")}
            >
              Team
            </button>
          )}

          <button
            className={`tab-btn ${view === "pastProjects" ? "tab-btn-active" : ""}`}
            onClick={() => setView("pastProjects")}
          >
            Past Projects
          </button>

          <form
            className="global-search"
            onSubmit={e => {
              e.preventDefault();
              if (!globalSearchQuery.trim()) return;
              router.push(`/dashboard/search?q=${encodeURIComponent(globalSearchQuery.trim())}`);
            }}
          >
            <input
              className="field global-search-input"
              placeholder="Search everything..."
              value={globalSearchQuery}
              onChange={e => setGlobalSearchQuery(e.target.value)}
            />
            <button className="btn btn-secondary" type="submit">Search</button>
          </form>
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
                          onClick={(e) => { e.stopPropagation(); router.push(c._kind === "pipeline" ? `/dashboard/pipeline/${c.id}` : `/dashboard/project/${c.id}`); }}
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
                onClick={() => router.push(c._kind === "pipeline" ? `/dashboard/pipeline/${c.id}` : `/dashboard/project/${c.id}`)}
              >
                <div className="customer-name" style={{ fontSize: 14 }}>{c.projectName || c.company}</div>
                {c.company && c.projectName && c.projectName !== c.company && (
                  <div className="customer-meta">{c.company}</div>
                )}
                <div className="customer-dates">Due: {formatDate(c.nextCheckIn)}</div>
                {c._kind === "pipeline" ? (
                  <span className="role-badge role-badge-admin" style={{ marginTop: 4 }}>✅ Won — Check In</span>
                ) : (
                  c.category && <span className="role-badge" style={{ marginTop: 4 }}>{c.category}</span>
                )}
                {c._kind === "project" && c.category === "Project Closed" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                    <button className="btn btn-secondary" onClick={() => snoozeClosedFollowUp(c)}>Snooze 3 Months</button>
                    <button className="btn btn-secondary" onClick={() => followUpAnotherYear(c)}>Follow Up in 1 Year</button>
                  </div>
                )}
                {c._kind === "pipeline" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                    <button className="btn btn-secondary" onClick={() => snoozePipelineFollowUp(c)}>Snooze 3 Months</button>
                    <button className="btn btn-secondary" onClick={() => pipelineFollowUpAnotherYear(c)}>Follow Up in 1 Year</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "personal" && role !== "estimating" && (
        <>
          {/* ADD PROJECT BUTTON */}
          <div style={{ marginBottom: 20 }}>
            <button className="btn btn-primary" onClick={() => router.push("/dashboard/project/new")}>ADD PROJECT</button>
          </div>

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

          {/* LIST -- projects and pipeline follow-ups interleaved by due
              date in one continuous list, not split into separate
              sections; pipeline entries get a "Pipeline" label instead so
              they're still tellable apart. */}
          {[
            ...filteredCustomers.map(c => {
            const days = diffDays(c.nextCheckIn);
            const isOwner = c.ownerId === uid;
            const pendingRequests = requestsById[c.id] || [];

            let barClass = "badge-bar-ok";
            if (days <= 0) barClass = "badge-bar-overdue";
            else if (days <= 2) barClass = "badge-bar-soon";

            return { sortKey: getDateValue(c.nextCheckIn), element: (
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
            ) };
          }),
            ...myPipelineEntries.map(p => ({
              sortKey: p.bidDate ? new Date(p.bidDate).getTime() : Infinity,
              element: (
                <div
                  key={`pipeline-${p.id}`}
                  className="customer-card"
                  onClick={() => router.push(`/dashboard/pipeline/${p.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <div className="customer-card-left">
                    <div className="customer-name">{p.title}</div>
                    <span className="role-badge role-badge-admin" style={{ marginTop: 6 }}>Pipeline · {p.stage}</span>
                  </div>
                  <div className="customer-card-middle">
                    {p.company && <div className="private-note-hint">{p.company}</div>}
                    {p.bidDate && <div className="customer-dates">Bid: {p.bidDate}</div>}
                  </div>
                </div>
              )
            }))
          ].sort((a, b) => a.sortKey - b.sortKey).map(item => item.element)}

          {filteredCustomers.length === 0 && myPipelineEntries.length === 0 && (
            <p className="private-note-hint">Nothing on your dashboard yet.</p>
          )}

          {/* COMPLETED POPUP */}
          {completedTarget && (
            <div className="modal-overlay">
              <div className="modal-card">
                <h3 className="modal-title">Mark Completed</h3>
                <p className="modal-subtitle" style={{ marginBottom: 12 }}>
                  This closes the project out and moves it to Past Projects. You'll be reminded to check back in on it in a year.
                </p>

                <label className="field-label">How was contact made?</label>
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

      {(view === "pipeline" || (view === "personal" && role === "estimating")) && (
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
                    companyCategory="Engineering Firm"
                    companyValue={pipelineCompany}
                    contactValue={pipelineContact}
                    emailValue={pipelineEmail}
                    phoneValue={pipelinePhone}
                    onCompanyChange={setPipelineCompany}
                    onContactChange={setPipelineContact}
                    onEmailChange={setPipelineEmail}
                    onPhoneChange={setPipelinePhone}
                  />

                  <div>
                    <label className="field-label">Project Address</label>
                    <AddressAutocomplete name="add-pipeline-projectAddress" value={pipelineProjectAddress} onChange={setPipelineProjectAddress} />
                  </div>
                </div>

                <h4 className="field-label" style={{ marginTop: 12 }}>Contractors Bidding (optional)</h4>
                {biddingCompanies.map((row, i) => (
                  <div key={i} className="bidding-company-row">
                    <CompanyContactFields
                      idPrefix={`add-pipeline-bidder-${i}`}
                      companies={companies}
                      contacts={contacts}
                      companyLabel="Contractor"
                      companyCategory="Contractor"
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

                <h4 className="field-label" style={{ marginTop: 12 }}>Assigned Team (optional)</h4>
                <div className="form-grid-2">
                  <div>
                    <label className="field-label">Salesperson</label>
                    <select className="field" value={pipelineSalespersonId} onChange={e => setPipelineSalespersonId(e.target.value)}>
                      <option value="">Unassigned</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Project Point Person</label>
                    <select className="field" value={pipelineProjectPointPersonId} onChange={e => setPipelineProjectPointPersonId(e.target.value)}>
                      <option value="">Unassigned</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email}</option>
                      ))}
                    </select>
                  </div>
                </div>

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

      {view === "pastProjects" && (
        <>
          <div className="toolbar">
            <input
              className="field"
              placeholder="Search past projects and pipeline entries..."
              value={pastProjectsSearch}
              onChange={e => setPastProjectsSearch(e.target.value)}
              style={{ flex: 1, marginBottom: 0 }}
            />
          </div>

          <h3 className="modal-title" style={{ marginTop: 8, marginBottom: 12 }}>Closed Projects</h3>
          {pastProjectsList.length === 0 && (
            <p className="private-note-hint">No closed projects yet.</p>
          )}
          {pastProjectsList.map(c => (
            <div
              key={c.id}
              className="customer-card"
              onClick={() => router.push(`/dashboard/project/${c.id}`)}
              style={{ cursor: "pointer" }}
            >
              <div className="customer-card-left">
                <div className="customer-name">{c.projectName || c.company}</div>
                <span className="role-badge" style={{ marginTop: 6 }}>{c.category}</span>
              </div>
              <div className="customer-card-middle">
                {c.company && <div className="private-note-hint">{c.company}</div>}
                <div className="private-note-hint">Owned by {ownerLabel(c.ownerId)}</div>
              </div>
            </div>
          ))}

          <h3 className="modal-title" style={{ marginTop: 28, marginBottom: 12 }}>Resolved Pipeline Entries</h3>
          {pastPipelineList.length === 0 && (
            <p className="private-note-hint">No won or lost pipeline entries yet.</p>
          )}
          {pastPipelineList.map(p => (
            <div
              key={p.id}
              className="customer-card"
              onClick={() => router.push(`/dashboard/pipeline/${p.id}`)}
              style={{ cursor: "pointer" }}
            >
              <div className="customer-card-left">
                <div className="customer-name">{p.title}</div>
                <span className={`role-badge ${p.outcome === "Won" ? "role-badge-admin" : ""}`} style={{ marginTop: 6 }}>
                  {p.outcome === "Won" ? "✅ Won" : "❌ Lost"}
                </span>
              </div>
              <div className="customer-card-middle">
                {p.company && <div className="private-note-hint">{p.company}</div>}
                {p.outcome === "Won" && p.wonByContractor && (
                  <div className="private-note-hint">Awarded to {p.wonByContractor}</div>
                )}
                <div className="private-note-hint">Owned by {ownerLabel(p.ownerId)}</div>
              </div>
            </div>
          ))}
        </>
      )}

      {view === "admin" && (
        <div className="admin-panel">
          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700 }}>Admin Settings</h2>
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
              <option value="member">Salesperson</option>
              <option value="estimating">Estimating Department</option>
              <option value="admin">Admin</option>
            </select>

            <label className="field-label" style={{ marginTop: 8 }}>Permissions</label>
            {PERMISSION_DEFS.map(p => (
              <label key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={newUserPermissions[p.key]}
                  onChange={() => setNewUserPermissions(prev => ({ ...prev, [p.key]: !prev[p.key] }))}
                />
                {p.label}
              </label>
            ))}

            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={createUser}>Create Account</button>
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
                          {roleLabel(u.role)}
                        </span>
                      </td>
                      <td>{u.disabled ? "Disabled" : "Active"}</td>
                      <td className="admin-table-actions">
                        {u.id === uid ? (
                          <span className="private-note-hint">Manage your own account from another admin's login.</span>
                        ) : (
                          <>
                            <select className="field" style={{ marginBottom: 0, display: "inline-block", width: "auto" }} value={u.role} onChange={e => changeUserRole(u, e.target.value)}>
                              <option value="member">Salesperson</option>
                              <option value="estimating">Estimating Department</option>
                              <option value="admin">Admin</option>
                            </select>
                            <button className="btn btn-secondary" onClick={() => openEditPermissions(u)}>Permissions</button>
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

          <div className="admin-card">
            <h3 className="modal-title">Directory</h3>
            <p className="modal-subtitle" style={{ marginBottom: 12 }}>
              The Directory (companies, contacts, tower models) only fills in when a project or pipeline entry is saved.
              Run this to backfill it from everything that already exists -- safe to re-run any time.
            </p>
            <button className="btn btn-secondary" disabled={rebuildingDirectory} onClick={rebuildDirectory}>
              {rebuildingDirectory ? "Rebuilding..." : "Rebuild Directory From Existing Data"}
            </button>

            <p className="modal-subtitle" style={{ marginTop: 16, marginBottom: 12 }}>
              A project's "Company" field is the contractor the job runs through, not the end customer --
              run this once to move anything that landed under "Customer" over to "Contractor."
            </p>
            <button className="btn btn-secondary" disabled={fixingContractorCategories} onClick={fixContractorCategories}>
              {fixingContractorCategories ? "Fixing..." : "Fix Contractor Categories"}
            </button>
          </div>
        </div>
      )}

      {editPermissionsTarget && (
        <div className="modal-overlay">
          <div className="modal-card">
            <button className="modal-close" onClick={() => setEditPermissionsTarget(null)}>✕</button>
            <h3 className="modal-title">Permissions</h3>
            <p className="modal-subtitle" style={{ marginBottom: 12 }}>{editPermissionsTarget.email}</p>

            {PERMISSION_DEFS.map(p => (
              <label key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={editPermissionsData[p.key]}
                  onChange={() => setEditPermissionsData(prev => ({ ...prev, [p.key]: !prev[p.key] }))}
                />
                {p.label}
              </label>
            ))}

            <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={savePermissions}>Save Permissions</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
