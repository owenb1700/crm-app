"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword
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
import { ensureCompanyAndContact, ensureCompanyAndContactBatch, OWNER_CATEGORY, firmTypeOf, BUILDING_SECTORS, WORK_TYPES } from "../../lib/directory";
import { isPipelineBidAlertFor, isWonFollowUpFor, isProjectCheckInFor } from "../../lib/alertRecipients";
import { bidderDirectoryEntries } from "../../lib/bidders";
import FirmTypeSelect from "../components/FirmTypeSelect";
import BuildingSectorSelect from "../components/BuildingSectorSelect";
import WorkTypeSelect from "../components/WorkTypeSelect";
import JobPicker from "../components/JobPicker";
import { RECORDS_CHANGED_EVENT } from "../components/TrashModal";
import { withoutTrashed, reminderJobIsActive } from "../../lib/trash";
import UserSettingsModal from "../components/UserSettingsModal";
import FilterBar, { matchesDateFilter, optionsFrom, isFilterActive } from "../components/FilterBar";
import { canViewAnalytics } from "../../lib/analytics";
import ClosedCheckInActions from "../components/ClosedCheckInActions";
import MyScorecard from "../components/MyScorecard";
import ExportDataModal from "../components/ExportDataModal";
import DeleteRecordButton from "../components/DeleteRecordButton";
import { CLOSED_OUTCOME, closeProjectPayload, isClosedWithCheckIn, isCheckInDue, yearsFrom, localDateKey } from "../../lib/closedProjects";
import { ensureTowerModel } from "../../lib/towerModels";
import CompanyContactFields from "../components/CompanyContactFields";
import MobileNav from "../components/MobileNav";
import EditUserModal from "../components/EditUserModal";
import { PERMISSION_DEFS, DEFAULT_PERMISSIONS, roleLabel, accessSummary } from "../../lib/permissions";
import { FirmSelect } from "../components/DirectoryPickers";
import GlobalSearch from "../components/GlobalSearch";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const CATEGORY_OPTIONS = ["Pre-Bid", "Bidding", "Prospecting", "Ongoing Project", "Order", "Parts", "Project Closed"];


// A pipeline entry with one of these outcomes is finished and lives in
// Past Projects. Only Won ever gets a follow-up check-in.
const RESOLVED_PIPELINE_OUTCOMES = ["Won", "Lost", "Did Not Bid"];

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

// Tabs that can be opened directly with a #hash (e.g. /dashboard#pipeline).
const HASH_VIEWS = ["personal", "pipeline", "team", "pastProjects", "admin"];

export default function Dashboard() {
  const router = useRouter();

  // AUTH / PROFILE
  const [uid, setUid] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [role, setRole] = useState(null); // 'admin' | 'member' | null (loading)
  // A #personal or #pipeline hash in the URL (e.g. after Cancel on
  // the Add Project / Add Pipeline Entry pages) opens straight to that
  // tab instead of always defaulting to Home.
  const [view, setView] = useState(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    return HASH_VIEWS.includes(hash) ? hash : "home";
  }); // 'home' | 'personal' | 'team' | 'admin'
  // Arriving from another page (e.g. Back to Pipeline), Next.js only puts
  // the #hash on the URL after this page first renders, so check again once
  // it's on screen and whenever the hash changes.
  useEffect(() => {
    const openHashView = () => {
      const hash = window.location.hash.slice(1);
      if (HASH_VIEWS.includes(hash)) setView(hash);
    };
    openHashView();
    const soon = setTimeout(openHashView, 0);
    window.addEventListener("hashchange", openHashView);
    return () => {
      clearTimeout(soon);
      window.removeEventListener("hashchange", openHashView);
    };
  }, []);
  const [selectedCalendarDay, setSelectedCalendarDay] = useState(null); // null = "this week" panel

  // NAME COLLECTION (first login without a name on file)
  const [needsName, setNeedsName] = useState(false);
  const [nameFirst, setNameFirst] = useState("");
  const [nameLast, setNameLast] = useState("");
  const [myProfile, setMyProfile] = useState(null);
  const [showUserSettings, setShowUserSettings] = useState(false);
  // null = closed; { self: true } or { target: user } for an admin export
  const [exportFor, setExportFor] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [notificationsError, setNotificationsError] = useState(null);

  const [customers, setCustomers] = useState([]);
  const [notesById, setNotesById] = useState({});
  const [users, setUsers] = useState([]);
  const [pipelineEntries, setPipelineEntries] = useState([]);
  // Whole-page filters for the Team, Pipeline, and Past Projects tabs --
  // see FilterBar for the value shapes.
  const [teamFilters, setTeamFilters] = useState({});
  const [pipelineFilters, setPipelineFilters] = useState({});
  const [personalFilters, setPersonalFilters] = useState({});
  // Filters sit behind a button on My Projects and Pipeline so the lists
  // start clean; opening one keeps it open while it has anything set.
  const [openFilters, setOpenFilters] = useState({});
  const [pastFilters, setPastFilters] = useState({});

  // REMINDERS: personal, private to whoever made them
  const [reminders, setReminders] = useState([]);
  const [remindersError, setRemindersError] = useState(null);
  const [reminderForm, setReminderForm] = useState(null); // null = closed; { id?, subject, date, notes }
  const [savingReminder, setSavingReminder] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [towerModels, setTowerModels] = useState([]);
  const [rebuildingDirectory, setRebuildingDirectory] = useState(false);

  // COLLABORATION
  const [requestsById, setRequestsById] = useState({}); // customerId -> pending requests on entries I own
  const [requestedIds, setRequestedIds] = useState(new Set()); // customerIds I've just requested (optimistic)

  // EDIT
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  // MODAL
  const [selected, setSelected] = useState(null);
  const [modalNotes, setModalNotes] = useState("");

  // COMPLETED
  const [completedTarget, setCompletedTarget] = useState(null);
  // The calendar item whose quick-view popup is open (Home calendar).
  const [calendarPopup, setCalendarPopup] = useState(null);
  const [completedOutcome, setCompletedOutcome] = useState("Won");
  const [wonNextDate, setWonNextDate] = useState("");
  const [lostNotes, setLostNotes] = useState("");
  const [lostTo, setLostTo] = useState("");
  const [prospectingNextDate, setProspectingNextDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toISOString().split("T")[0];
  });

  // TOAST
  const [toast, setToast] = useState("");

  // SEARCH
  const [pastProjectsSearch, setPastProjectsSearch] = useState("");
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");

  // ADMIN: create user form
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("member");
  const [newUserFirstName, setNewUserFirstName] = useState("");
  const [newUserLastName, setNewUserLastName] = useState("");
  const [newUserPermissions, setNewUserPermissions] = useState(DEFAULT_PERMISSIONS);
  const [showAddUser, setShowAddUser] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [editUserTarget, setEditUserTarget] = useState(null);

  const col = collection(db, "customers");

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 5000);
  };

  // A message left by another page right before sending someone here (e.g.
  // Add Pipeline Entry after saving), shown once.
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("dashboardToast");
      if (pending) {
        sessionStorage.removeItem("dashboardToast");
        showToast(pending);
      }
    } catch {
      // Storage unavailable -- nothing to show.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    let list = withoutTrashed(snap.docs.map(d => ({ id: d.id, ...d.data() })));

    // Migrate legacy customers with no owner to whichever admin loads them.
    const orphans = list.filter(c => !c.ownerId);
    if (isAdmin && orphans.length) {
      await Promise.all(
        orphans.map(c => updateDoc(doc(db, "customers", c.id), { ownerId: currentUid }))
      );
      list = list.map(c => (c.ownerId ? c : { ...c, ownerId: currentUid }));
    }

    list = await reactivateDueClosedProjects(list, currentUid, isAdmin);

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
    setPipelineEntries(withoutTrashed(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  };

  const loadDirectory = async () => {
    const [companiesSnap, contactsSnap] = await Promise.all([
      getDocs(collection(db, "companies")),
      getDocs(collection(db, "contacts"))
    ]);
    setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  // Reminder dates are plain "YYYY-MM-DD" strings in the user's own local
  // time -- built and read with local Date parts, never toISOString(),
  // which would shift the date a day back for anyone west of UTC.
  const toLocalDateKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fromLocalDateKey = (key) => {
    const [y, m, d] = (key || "").split("-").map(Number);
    return y ? new Date(y, m - 1, d) : new Date();
  };
  const skipWeekend = (d) => {
    const next = new Date(d);
    if (next.getDay() === 6) next.setDate(next.getDate() + 2);
    if (next.getDay() === 0) next.setDate(next.getDate() + 1);
    return next;
  };

  const loadReminders = async (currentUid) => {
    const snap = await getDocs(query(collection(db, "reminders"), where("userId", "==", currentUid)));
    setReminders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    setRemindersError(null);
  };

  // A reminder's attached job as a JobPicker key ("project:<id>" / "pipeline:<id>").
  const jobKeyOf = (r) => (r.projectId ? `project:${r.projectId}` : r.pipelineId ? `pipeline:${r.pipelineId}` : "");

  const openEditReminder = (r) => {
    setReminderForm({ id: r.id, subject: r.subject || "", date: r.date || toLocalDateKey(new Date()), notes: r.notes || "", job: jobKeyOf(r) });
  };

  const saveReminder = async () => {
    const subject = reminderForm.subject.trim();
    if (!subject) return alert("Enter a subject for this reminder");

    // Weekend dates move to Monday, same as project check-ins -- the
    // calendar only shows weekdays, so a Saturday reminder would never
    // appear on it.
    const date = toLocalDateKey(skipWeekend(fromLocalDateKey(reminderForm.date)));
    const notes = reminderForm.notes.trim() || null;
    const [jobKind, jobId] = (reminderForm.job || "").split(":");
    const job = {
      projectId: jobKind === "project" ? jobId : null,
      pipelineId: jobKind === "pipeline" ? jobId : null
    };

    setSavingReminder(true);
    try {
      if (reminderForm.id) {
        await updateDoc(doc(db, "reminders", reminderForm.id), { subject, date, notes, ...job });
      } else {
        await addDoc(collection(db, "reminders"), {
          userId: uid,
          subject,
          date,
          notes,
          ...job,
          createdAt: new Date().toISOString()
        });
      }
      setReminderForm(null);
      showToast(reminderForm.id ? "Reminder updated" : `Reminder added for ${date}`);
      await loadReminders(uid);
    } catch (err) {
      alert(`Couldn't save this reminder: ${err.message}`);
    } finally {
      setSavingReminder(false);
    }
  };

  const completeReminder = async (r) => {
    if (!window.confirm(`Mark "${r.subject}" complete? It will be deleted permanently.`)) return;
    try {
      await deleteDoc(doc(db, "reminders", r.id));
      setReminders(prev => prev.filter(x => x.id !== r.id));
      setReminderForm(null);
      showToast("Reminder completed");
    } catch (err) {
      alert(`Couldn't complete this reminder: ${err.message}`);
    }
  };

  const followUpReminder = async (r) => {
    const next = fromLocalDateKey(r.date);
    next.setDate(next.getDate() + 14);
    const date = toLocalDateKey(skipWeekend(next));
    try {
      await updateDoc(doc(db, "reminders", r.id), { date });
      setReminders(prev => prev.map(x => (x.id === r.id ? { ...x, date } : x)));
      setReminderForm(null);
      showToast(`Reminder moved to ${date}`);
    } catch (err) {
      alert(`Couldn't move this reminder: ${err.message}`);
    }
  };

  const reminderDaysAway = (r) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((fromLocalDateKey(r.date) - today) / (1000 * 60 * 60 * 24));
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
          companyName: c.company, category: firmTypeOf(c.companyCategory),
          contactName: c.contact, email: c.email, phone: c.phone
        });
        (c.owners || []).forEach(o => {
          captureEntries.push({
            companyName: o.company, category: OWNER_CATEGORY,
            contactName: o.contact, email: o.email, phone: o.phone
          });
        });
      });

      pipelineEntries.forEach(p => {
        captureEntries.push({
          companyName: p.company, category: "Engineering Firm",
          contactName: p.contact, email: p.email, phone: p.phone
        });
        captureEntries.push(...bidderDirectoryEntries(p.biddingCompanies, firmTypeOf));
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
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, html })
      });
      // A non-network failure (Gmail rejected it, etc.) already alerts
      // every admin server-side (see /api/send-email) -- this just keeps
      // it out of a silent void in the browser console too.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error(`Failed to send "${subject}" to ${to}:`, data.error, data.code ? `(code ${data.code})` : "");
      }
    } catch (err) {
      // best-effort -- don't let a failed email break the actual action,
      // but a true network failure here (offline, etc.) is at least worth
      // seeing in devtools.
      console.error(`Failed to send "${subject}" to ${to}:`, err.message);
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

  // Won and Prospecting Only are the only closed outcomes that ever come
  // back -- Lost and Not Pursuing stay in Past Projects with no further
  // alerts until someone edits them by hand. There's no server-side cron
  // here, so whichever teammate's session next loads the customer list is
  // what actually catches a due date and flips it back to active --
  // acceptable for a small internal tool, but it means reactivation can
  // lag until someone opens the dashboard.
  //
  // Firestore rules only let the owner (or an admin) update a customer
  // doc, so this can only actually reactivate items the current session
  // has permission to touch -- everyone else's due items wait for their
  // own owner (or an admin) to next load the dashboard instead. Each
  // update is isolated in its own try/catch so one failure (permission or
  // otherwise) can't break loading the rest of the list.
  const reactivateDueClosedProjects = async (list, currentUid, isAdmin) => {
    const canTouch = (c) => isAdmin || c.ownerId === currentUid;
    const updates = new Map(); // customer id -> fields applied locally too

    const reportFailure = (label, c, err) => {
      // Leave it for now -- it'll be retried next time its owner or an admin
      // loads the dashboard. Still tell an admin, so a change that keeps
      // failing (a permissions bug, say) doesn't go unnoticed.
      fetch("/api/report-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area: "Closed project update", message: `Failed to update "${label}" (customer ${c.id})`, detail: err.message })
      }).catch(() => {});
    };

    const apply = async (c, fields, notice) => {
      const label = c.projectName || c.company || "A project";
      try {
        await updateDoc(doc(db, "customers", c.id), fields);
        if (notice) await notifyUser(c.ownerId, { type: "reactivated", message: notice(label), link: `/dashboard/project/${c.id}` });
        updates.set(c.id, fields);
      } catch (err) {
        reportFailure(label, c, err);
      }
    };

    const now = new Date();
    await Promise.all(list.filter(c => c.category === "Project Closed" && canTouch(c)).map(c => {
      // Won projects no longer close -- anything closed as Won under the old
      // flow goes back onto My Projects, keeping the date it was scheduled for.
      if (c.closedOutcome === "Won") {
        return apply(c, {
          category: "Ongoing Project",
          closedOutcome: null,
          closedAt: null,
          nextCheckIn: c.nextCheckIn || localDateKey(now)
        });
      }
      // Projects closed before outcomes existed (or by changing the category
      // by hand under the old rules) move onto the Project Closed check-in:
      // due 1 year after they were closed.
      if (!c.closedOutcome) {
        return apply(c, {
          closedOutcome: CLOSED_OUTCOME,
          nextCheckIn: yearsFrom(closedDateOf(c).slice(0, 10) || localDateKey(now), 1)
        });
      }
      // Prospecting Only still comes back to My Projects on its date.
      if (c.closedOutcome === "Prospecting Only" && c.nextCheckIn && new Date(c.nextCheckIn) <= now) {
        return apply(c, { category: "Prospecting", closedOutcome: null, nextCheckIn: null },
          (label) => `Reminder: reach out to the contractor on ${label} (prospecting follow-up)`);
      }
      return null;
    }));

    return updates.size ? list.map(c => (updates.has(c.id) ? { ...c, ...updates.get(c.id) } : c)) : list;
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
        emailHtml: `<p>Your request to collaborate on <strong>${projectLabel}</strong> was approved. It now shows up in your My Projects.</p>`,
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

          await loadCustomers(user.uid, profile.role === "admin");
          await loadPipeline();
          await loadDirectory();
          await loadTowerModels();
          // Same isolation as the alerts bell below: reminders failing to
          // load (e.g. the Firestore rule isn't published yet) shows an
          // error where reminders appear instead of breaking the dashboard.
          try {
            await loadReminders(user.uid);
          } catch (err) {
            setRemindersError(err.message || "Couldn't load reminders.");
          }
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

  const startEdit = (c) => {
    setEditingId(c.id);
    setEditData({
      projectName: c.projectName || c.company || "",
      company: c.company || "",
      companyCategory: firmTypeOf(c.companyCategory),
      contact: c.contact || "",
      email: c.email || "",
      phone: c.phone || "",
      category: c.category || "",
      buildingSector: c.buildingSector || "",
      workType: c.workType || "",
      nextCheckIn: formatDate(c.nextCheckIn),
      lastContact: formatDate(c.lastContact)
    });
  };

  const saveEdit = async () => {
    if (!editData.buildingSector) {
      return alert("Please select a building sector");
    }
    if (!editData.workType) {
      return alert("Please select a work type (new installation, replacement, or repair)");
    }
    const original = customers.find(c => c.id === editingId);
    const payload = { ...editData };

    // Closing a project schedules a 6-month "how are things going" check-in
    // automatically, so it resurfaces on the Home calendar even though it's
    // now hidden from the active My Projects list.
    if (editData.category === "Project Closed" && original?.category !== "Project Closed") {
      Object.assign(payload, closeProjectPayload(original?.activityLog));
    } else if (editData.category !== "Project Closed" && original?.category === "Project Closed") {
      payload.closedOutcome = null;
      payload.closedAt = null;
    }

    await updateDoc(doc(db, "customers", editingId), payload);

    ensureCompanyAndContact({
      companies, contacts, companyName: editData.company, category: editData.companyCategory,
      contactName: editData.contact, email: editData.email, phone: editData.phone, uid
    }).then(loadDirectory);

    setEditingId(null);
    setEditData({});
    showToast("Changes saved");
    loadCustomers(uid, role === "admin");
  };

  const handleFollowUp = async (c) => {
    const next = new Date();
    next.setDate(next.getDate() + 14);

    await updateDoc(doc(db, "customers", c.id), {
      nextCheckIn: adjustWeekend(next.toISOString())
    });

    showToast("Follow-up scheduled for 2 weeks");
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
    setCompletedOutcome("Won");
    setWonNextDate("");
    setLostNotes("");
    setLostTo("");
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    setProspectingNextDate(d.toISOString().split("T")[0]);
  };

  const confirmCompleted = async () => {
    if (completedOutcome === CLOSED_OUTCOME) {
      await updateDoc(doc(db, "customers", completedTarget.id), {
        ...closeProjectPayload(completedTarget.activityLog),
        lostReason: null,
        lostTo: null
      });
      setCompletedTarget(null);
      setCompletedOutcome("Won");
      showToast("Project closed — moved to Past Projects with a 1-year check-in");
      loadCustomers(uid, role === "admin");
      return;
    }
    if (completedOutcome === "Won" && !wonNextDate) {
      return alert("Please choose the next due date");
    }
    if (completedOutcome === "Lost" && !lostNotes.trim()) {
      return alert("Please enter why the job was lost");
    }
    if (completedOutcome === "Prospecting Only" && !prospectingNextDate) {
      return alert("Please choose the next alert date");
    }

    // What happens depends on the outcome:
    // - Won: the project does NOT close. It stays on My Projects as an
    //   Ongoing Project, due on the chosen next date; the win is recorded
    //   in the activity log.
    // - Otherwise it closes out the same way changing its category to
    //   "Project Closed" does: it drops off My Projects into Past Projects.
    // - Prospecting Only: comes back to My Projects (as Prospecting) on
    //   the chosen next-alert date (default 3 months), with an alert to
    //   reach out to the contractor. Picking Prospecting Only again from
    //   here restarts the same cycle -- it can be snoozed indefinitely by
    //   just re-choosing it each time it resurfaces.
    // - Lost / Not Pursuing: no further alerts, stays in Past Projects
    //   until someone edits it by hand.
    const entry = {
      type: "completed",
      outcome: completedOutcome,
      timestamp: new Date().toISOString(),
      ...(completedOutcome === "Won" && { nextDueDate: wonNextDate }),
      ...(completedOutcome === "Lost" && { notes: lostNotes.trim(), lostTo: lostTo.trim() || null })
    };

    const payload = {
      category: "Project Closed",
      closedOutcome: completedOutcome,
      closedAt: entry.timestamp,
      activityLog: [
        ...(completedTarget.activityLog || []),
        entry
      ]
    };

    // Picked dates are read as local calendar dates -- new Date("YYYY-MM-DD")
    // would parse as UTC midnight and land a day early (then get
    // weekend-adjusted wrong) for anyone west of UTC.
    const pickedDate = (key) => toLocalDateKey(skipWeekend(fromLocalDateKey(key)));

    if (completedOutcome === "Won") {
      payload.category = "Ongoing Project";
      payload.closedOutcome = null;
      payload.closedAt = null;
      payload.wonAt = entry.timestamp;
      payload.nextCheckIn = pickedDate(wonNextDate);
    } else if (completedOutcome === "Prospecting Only") {
      payload.nextCheckIn = pickedDate(prospectingNextDate);
    } else {
      payload.nextCheckIn = null;
    }

    // Kept on the project itself (not just the activity log) so Past
    // Projects can show why it was lost and who won it at a glance.
    payload.lostReason = completedOutcome === "Lost" ? lostNotes.trim() : null;
    payload.lostTo = completedOutcome === "Lost" ? (lostTo.trim() || null) : null;

    await updateDoc(doc(db, "customers", completedTarget.id), payload);

    setCompletedTarget(null);
    setCompletedOutcome("Won");
    setWonNextDate("");
    setLostNotes("");
    setLostTo("");

    showToast(completedOutcome === "Won"
      ? `Marked won — stays on My Projects, next due ${payload.nextCheckIn}`
      : "Marked completed — moved to Past Projects");
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

    const f = personalFilters;
    if (f.sector) list = list.filter(c => c.buildingSector === f.sector);
    if (f.workType) list = list.filter(c => c.workType === f.workType);
    if (f.firm) list = list.filter(c => c.company === f.firm || (c.owners || []).some(o => o.company === f.firm));
    if (f.status) list = list.filter(c => c.category === f.status);
    list = list.filter(c => matchesDateFilter(c.nextCheckIn, f.due));

    return [...list].sort(
      (a, b) => getDateValue(a.nextCheckIn) - getDateValue(b.nextCheckIn)
    );
  }, [customers, uid, personalFilters]);

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
  // When a project was closed, for sorting Past Projects newest first.
  // closedAt is only recorded on projects closed after it was added; older
  // ones fall back to their latest "completed" activity, then their last
  // contact date, then when they were created.
  const closedDateOf = (c) => {
    if (c.closedAt) return c.closedAt;
    const completions = (c.activityLog || []).filter(a => a.type === "completed" && a.timestamp);
    if (completions.length) return completions[completions.length - 1].timestamp;
    return formatDate(c.lastContact) || c.createdAt || "";
  };

  // Why a lost project was lost and who won it. Projects closed before these
  // were stored on the project itself only have them on their "completed"
  // activity entry, where the reason used to be one combined note.
  const lostInfoOf = (c) => {
    const entry = [...(c.activityLog || [])].reverse().find(a => a.type === "completed" && a.outcome === "Lost");
    return {
      reason: c.lostReason || entry?.notes || "",
      winner: c.lostTo || entry?.lostTo || ""
    };
  };

  const pastProjectsList = useMemo(() => {
    let list = customers.filter(c => c.category === "Project Closed");
    const f = pastFilters;
    if (f.show === "pipeline") list = [];
    if (f.sector) list = list.filter(c => c.buildingSector === f.sector);
    if (f.workType) list = list.filter(c => c.workType === f.workType);
    if (f.person) list = list.filter(c => c.ownerId === f.person);
    if (f.firm) list = list.filter(c =>
      c.company === f.firm ||
      (c.owners || []).some(o => o.company === f.firm) ||
      lostInfoOf(c).winner === f.firm
    );
    if (f.outcome) list = list.filter(c => c.closedOutcome === f.outcome);
    list = list.filter(c => matchesDateFilter(closedDateOf(c), f.closed));
    if (pastProjectsSearch.trim()) {
      const q = pastProjectsSearch.toLowerCase();
      list = list.filter(c =>
        (c.projectName || "").toLowerCase().includes(q) ||
        (c.company || "").toLowerCase().includes(q) ||
        lostInfoOf(c).reason.toLowerCase().includes(q) ||
        lostInfoOf(c).winner.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) =>
      getDateValue(closedDateOf(b)) - getDateValue(closedDateOf(a)) ||
      (a.projectName || "").localeCompare(b.projectName || "")
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, pastProjectsSearch, pastFilters]);

  const pastPipelineList = useMemo(() => {
    let list = pipelineEntries.filter(p => RESOLVED_PIPELINE_OUTCOMES.includes(p.outcome));
    const f = pastFilters;
    if (f.show === "projects") list = [];
    if (f.sector) list = list.filter(p => p.buildingSector === f.sector);
    if (f.workType) list = list.filter(p => p.workType === f.workType);
    if (f.person) list = list.filter(p => p.ownerId === f.person || p.salespersonId === f.person);
    if (f.firm) list = list.filter(p =>
      p.company === f.firm ||
      (p.biddingCompanies || []).some(b => b.company === f.firm) ||
      p.wonByContractor === f.firm ||
      p.lostTo === f.firm
    );
    if (f.outcome) list = list.filter(p => p.outcome === f.outcome);
    list = list.filter(p => matchesDateFilter(p.resolvedAt, f.closed));
    if (pastProjectsSearch.trim()) {
      const q = pastProjectsSearch.toLowerCase();
      list = list.filter(p =>
        (p.title || "").toLowerCase().includes(q) ||
        (p.company || "").toLowerCase().includes(q) ||
        (p.wonByContractor || "").toLowerCase().includes(q) ||
        (p.lostReason || "").toLowerCase().includes(q) ||
        (p.lostTo || "").toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => (b.resolvedAt || "").localeCompare(a.resolvedAt || ""));
  }, [pipelineEntries, pastProjectsSearch, pastFilters]);

  const teamCustomers = useMemo(() => {
    let list = [...customers].sort(
      (a, b) => getDateValue(a.nextCheckIn) - getDateValue(b.nextCheckIn)
    );

    const f = teamFilters;
    if (f.sector) list = list.filter(c => c.buildingSector === f.sector);
    if (f.workType) list = list.filter(c => c.workType === f.workType);
    if (f.person) list = list.filter(c => c.ownerId === f.person);
    if (f.firm) list = list.filter(c => c.company === f.firm || (c.owners || []).some(o => o.company === f.firm));
    if (f.status) list = list.filter(c => c.category === f.status);
    if (f.outcome) list = list.filter(c => c.closedOutcome === f.outcome);
    list = list.filter(c => matchesDateFilter(c.nextCheckIn, f.due));

    return list;
  }, [customers, teamFilters]);

  const ownerLabel = (ownerId) => {
    if (ownerId === uid) return "You";
    const u = users.find(u => u.id === ownerId);
    if (!u) return "Teammate";
    return u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email;
  };

  const filteredPipeline = useMemo(() => {
    let list = pipelineEntries.filter(p => !p.outcome);

    const f = pipelineFilters;
    if (f.sector) list = list.filter(p => p.buildingSector === f.sector);
    if (f.workType) list = list.filter(p => p.workType === f.workType);
    if (f.person) list = list.filter(p => p.salespersonId === f.person);
    if (f.owner) list = list.filter(p => p.ownerId === f.owner);
    if (f.engineeringFirm) list = list.filter(p => p.company === f.engineeringFirm);
    if (f.bidder) list = list.filter(p => (p.biddingCompanies || []).some(b => b.company === f.bidder));
    if (f.stage) list = list.filter(p => p.stage === f.stage);
    list = list.filter(p => matchesDateFilter(p.bidDate, f.bidDate));

    return list.sort((a, b) => {
      const aDate = a.bidDate || "9999-99-99";
      const bDate = b.bidDate || "9999-99-99";
      return aDate.localeCompare(bDate);
    });
  }, [pipelineEntries, pipelineFilters]);

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

  // Reminders attached to a job that's been deleted (in the Trash) stay
  // hidden until the job is restored.
  const activeReminders = useMemo(
    () => reminders.filter(r => reminderJobIsActive(r, customers, pipelineEntries)),
    [reminders, customers, pipelineEntries]
  );

  // Restoring something from the Trash refreshes the lists here.
  useEffect(() => {
    if (!uid) return undefined;
    const reload = () => {
      loadCustomers(uid, role === "admin");
      loadPipeline();
    };
    window.addEventListener(RECORDS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(RECORDS_CHANGED_EVENT, reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, role]);

  const myCalendarProjects = useMemo(() => {
    // Who sees what is decided in lib/alertRecipients.js, shared with All
    // Alerts and the digest emails.
    const projectItems = customers
      .filter(c => isProjectCheckInFor(c, uid, role))
      .map(c => ({ ...c, _kind: "project" }));

    const pipelineFollowUps = pipelineEntries
      .filter(p => isWonFollowUpFor(p, uid, role))
      .map(p => ({ ...p, _kind: "pipeline", projectName: p.title }));

    // Open pipeline entries' bid dates, for everyone on the hook for them
    // (see isPipelineBidAlertFor).
    const bidDates = pipelineEntries
      .filter(p => isPipelineBidAlertFor(p, uid, role))
      .map(p => ({ ...p, _kind: "bid", projectName: p.title, nextCheckIn: p.bidDate }));

    const reminderItems = activeReminders.map(r => ({ ...r, _kind: "reminder", projectName: r.subject, nextCheckIn: r.date }));

    return [...projectItems, ...pipelineFollowUps, ...bidDates, ...reminderItems];
  }, [customers, pipelineEntries, activeReminders, uid, role]);

  // Jobs a reminder can be attached to: active projects you own or
  // collaborate on (every active project for admins) and open pipeline
  // entries, which the whole team can see.
  const reminderJobOptions = useMemo(() => {
    const projects = customers
      .filter(c => c.category !== "Project Closed")
      .filter(c => role === "admin" || c.ownerId === uid || (c.collaboratorIds || []).includes(uid))
      .map(c => ({
        key: `project:${c.id}`, kind: "project", id: c.id,
        label: c.projectName || c.company || "Untitled project",
        sub: [c.projectName && c.company !== c.projectName ? c.company : "", c.projectAddress].filter(Boolean).join(" · ")
      }));
    const pipeline = pipelineEntries
      .filter(p => !p.outcome && !p.convertedToProjectId)
      .map(p => ({
        key: `pipeline:${p.id}`, kind: "pipeline", id: p.id,
        label: p.title || "Untitled pipeline entry",
        sub: [p.stage, p.bidDate && `Bid ${p.bidDate}`, p.company].filter(Boolean).join(" · ")
      }));
    return [...projects, ...pipeline].sort((a, b) => a.label.localeCompare(b.label));
  }, [customers, pipelineEntries, role, uid]);

  const jobTitleOf = (r) => {
    if (r.projectId) {
      const c = customers.find(x => x.id === r.projectId);
      return c ? (c.projectName || c.company || "Untitled project") : "a project";
    }
    if (r.pipelineId) {
      const p = pipelineEntries.find(x => x.id === r.pipelineId);
      return p ? (p.title || "Untitled pipeline entry") : "a pipeline entry";
    }
    return "";
  };

  // Everything on the Home calendar opens a quick-view popup first; the
  // popup has the item's own actions plus a button to its full page.
  const openCalendarItem = (c) => setCalendarPopup(c);

  const calendarItemLink = (c) => {
    if (c._kind === "reminder") {
      if (c.projectId) return `/dashboard/project/${c.projectId}`;
      return c.pipelineId ? `/dashboard/pipeline/${c.pipelineId}` : null;
    }
    return c._kind === "pipeline" || c._kind === "bid" ? `/dashboard/pipeline/${c.id}` : `/dashboard/project/${c.id}`;
  };

  // Runs a popup action, then closes the popup.
  const fromPopup = (action) => async () => {
    const item = calendarPopup;
    setCalendarPopup(null);
    await action(item);
  };

  // Which calendar day an alert sits on. The calendar only has weekdays
  // from this week on, so nothing is left off it: anything overdue shows on
  // today, and a Saturday/Sunday date shows on the Monday after.
  const calendarKeyFor = (c) => {
    const due = String(formatDate(c.nextCheckIn) || "").slice(0, 10);
    if (!due) return "";
    const todayKey = toLocalDateKey(new Date());
    return toLocalDateKey(skipWeekend(fromLocalDateKey(due < todayKey ? todayKey : due)));
  };
  const isOverdueItem = (c) => {
    const due = String(formatDate(c.nextCheckIn) || "").slice(0, 10);
    return !!due && due < toLocalDateKey(new Date());
  };

  const projectsByDay = useMemo(() => {
    const map = {};
    myCalendarProjects.forEach(c => {
      const key = calendarKeyFor(c);
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
      .filter(c => weekSet.has(calendarKeyFor(c)))
      .sort((a, b) => getDateValue(a.nextCheckIn) - getDateValue(b.nextCheckIn));
  }, [selectedCalendarDay, projectsByDay, weekKeys, myCalendarProjects]);

  const panelTitle = selectedCalendarDay
    ? new Date(selectedCalendarDay + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : "This Week";

  // ADMIN
  const resetNewUserForm = () => {
    setNewUserEmail("");
    setNewUserRole("member");
    setNewUserFirstName("");
    setNewUserLastName("");
    setNewUserPermissions(DEFAULT_PERMISSIONS);
  };

  // The Add User popup only closes through Add User (on success) or Cancel,
  // and Cancel wipes the form -- so nothing half-entered is left behind.
  const cancelAddUser = () => {
    if (creatingUser) return;
    resetNewUserForm();
    setShowAddUser(false);
  };

  const createUser = async () => {
    const email = newUserEmail.trim();
    if (!email) return alert("Enter an email");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return alert("Enter a valid email address");

    setCreatingUser(true);
    let accountCreated = false;
    try {
      const secondaryAuth = getSecondaryAuth();
      const tempPassword = Math.random().toString(36).slice(-10) + "Aa1!";
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword);

      await setDoc(doc(db, "users", cred.user.uid), {
        email,
        role: newUserRole,
        firstName: newUserFirstName.trim() || null,
        lastName: newUserLastName.trim() || null,
        disabled: false,
        permissions: newUserPermissions,
        createdAt: new Date().toISOString()
      });
      accountCreated = true;

      await signOut(secondaryAuth);

      // Their first-ever set-password link, good for 48 hours -- see
      // /api/send-reset-link and lib/passwordReset.js.
      const res = await fetch("/api/send-reset-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, newAccount: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "the setup email failed to send");

      resetNewUserForm();
      setShowAddUser(false);
      showToast("Account created — setup email sent (link valid for 48 hours)");
      loadUsers();
    } catch (err) {
      if (accountCreated) {
        // The account exists now, so leaving the form open would only lead to
        // an "email already in use" error on retry. Close it and point to
        // the way to get them their setup email.
        resetNewUserForm();
        setShowAddUser(false);
        loadUsers();
        alert(`The account for ${email} was created, but ${err.message}. Use "Send Reset Link" on their row in Team Members to email them a setup link.`);
      } else {
        alert(err.message || "Could not create account");
      }
    } finally {
      setCreatingUser(false);
    }
  };

  const myPermissions = role === "admin"
    ? PERMISSION_DEFS.reduce((acc, p) => ({ ...acc, [p.key]: true }), {})
    : { ...DEFAULT_PERMISSIONS, ...(myProfile?.permissions || {}) };

  // FILTER BAR DEFINITIONS -- options come from the data actually on each
  // page, so a dropdown never offers a value that matches nothing.
  const personOption = (id) => ({ value: id, label: ownerLabel(id) });
  const sectorFilter = { key: "sector", label: "Sector", type: "select", options: BUILDING_SECTORS.map(v => ({ value: v, label: v })) };
  const workTypeFilter = { key: "workType", label: "Work type", type: "select", options: WORK_TYPES.map(v => ({ value: v, label: v })) };
  const setFilter = (setter) => (key, value) => setter(prev => ({ ...prev, [key]: value }));

  const teamFilterDefs = [
    sectorFilter,
    workTypeFilter,
    { key: "person", label: "Salesperson", type: "select", options: optionsFrom(customers.map(c => c.ownerId), ownerLabel).map(o => personOption(o.value)) },
    { key: "firm", label: "Contractor / Owner", type: "select", options: optionsFrom(customers.flatMap(c => [c.company, ...(c.owners || []).map(o => o.company)])) },
    { key: "status", label: "Status", type: "select", options: optionsFrom(customers.map(c => c.category)) },
    { key: "outcome", label: "Outcome", type: "select", options: optionsFrom(customers.map(c => c.closedOutcome)) },
    { key: "due", label: "Next check-in", type: "date", presets: ["overdue", "today", "next7", "next30"] }
  ];

  const myActiveProjects = customers.filter(c =>
    (c.ownerId === uid || (c.collaboratorIds || []).includes(uid)) && c.category !== "Project Closed"
  );
  const personalFilterDefs = [
    sectorFilter,
    workTypeFilter,
    { key: "firm", label: "Contractor / Owner", type: "select", options: optionsFrom(myActiveProjects.flatMap(c => [c.company, ...(c.owners || []).map(o => o.company)])) },
    { key: "status", label: "Status", type: "select", options: optionsFrom(myActiveProjects.map(c => c.category)) },
    { key: "due", label: "Next check-in", type: "date", presets: ["overdue", "today", "next7", "next30"] }
  ];

  const openPipeline = pipelineEntries.filter(p => !p.outcome);
  const pipelineFilterDefs = [
    sectorFilter,
    workTypeFilter,
    { key: "person", label: "Salesperson", type: "select", options: optionsFrom(openPipeline.map(p => p.salespersonId), ownerLabel).map(o => personOption(o.value)) },
    { key: "owner", label: "Owner", type: "select", options: optionsFrom(openPipeline.map(p => p.ownerId), ownerLabel).map(o => personOption(o.value)) },
    { key: "engineeringFirm", label: "Engineering firm", type: "select", options: optionsFrom(openPipeline.map(p => p.company)) },
    { key: "bidder", label: "Bidding contractor", type: "select", options: optionsFrom(openPipeline.flatMap(p => (p.biddingCompanies || []).map(b => b.company))) },
    { key: "stage", label: "Stage", type: "select", options: optionsFrom(openPipeline.map(p => p.stage)) },
    { key: "bidDate", label: "Bid date", type: "date", presets: ["overdue", "next7", "next30", "last30", "thisYear"] }
  ];

  const closedProjects = customers.filter(c => c.category === "Project Closed");
  const resolvedPipeline = pipelineEntries.filter(p => RESOLVED_PIPELINE_OUTCOMES.includes(p.outcome));
  const pastFilterDefs = [
    { key: "show", label: "Show", type: "select", anyLabel: "Projects & pipeline", options: [{ value: "projects", label: "Closed projects only" }, { value: "pipeline", label: "Pipeline entries only" }] },
    sectorFilter,
    workTypeFilter,
    { key: "person", label: "Salesperson", type: "select", options: optionsFrom([...closedProjects.map(c => c.ownerId), ...resolvedPipeline.flatMap(p => [p.ownerId, p.salespersonId])], ownerLabel).map(o => personOption(o.value)) },
    { key: "firm", label: "Contractor / Firm", type: "select", options: optionsFrom([
      ...closedProjects.flatMap(c => [c.company, ...(c.owners || []).map(o => o.company), lostInfoOf(c).winner]),
      ...resolvedPipeline.flatMap(p => [p.company, p.wonByContractor, p.lostTo, ...(p.biddingCompanies || []).map(b => b.company)])
    ]) },
    { key: "outcome", label: "Outcome", type: "select", options: optionsFrom([...closedProjects.map(c => c.closedOutcome), ...resolvedPipeline.map(p => p.outcome)]) },
    { key: "closed", label: "Closed / resolved", type: "date", presets: ["last30", "last90", "thisYear", "lastYear"] }
  ];
  const anyActive = (values) => Object.values(values).some(isFilterActive);

  // One item in the Home calendar's side panel (and the phone agenda):
  // name, due date, a badge for what kind of date it is, and whatever quick
  // actions that kind supports.
  const renderCalendarItem = (c) => (
          <div
            key={`${c._kind}-${c.id}`}
            className="calendar-panel-item"
            onClick={() => openCalendarItem(c)}
          >
            <div className="customer-name" style={{ fontSize: 14 }}>{c.projectName || c.company}</div>
            {c.company && c.projectName && c.projectName !== c.company && (
              <div className="customer-meta">{c.company}</div>
            )}
            {c._kind === "reminder" && c.notes && (
              <div className="customer-meta" style={{ whiteSpace: "pre-wrap" }}>{c.notes}</div>
            )}
            <div className="customer-dates">
              Due: {String(formatDate(c.nextCheckIn)).slice(0, 10)}
              {isOverdueItem(c) && <span className="calendar-overdue-tag">Overdue</span>}
            </div>
            {c._kind === "bid" ? (
              <span className="role-badge role-badge-admin" style={{ marginTop: 4 }}>Bid date · {c.stage}</span>
            ) : c._kind === "pipeline" ? (
              <span className="role-badge role-badge-admin" style={{ marginTop: 4 }}>✅ Won — Check In</span>
            ) : c._kind === "reminder" ? (
              <>
                <span className="role-badge" style={{ marginTop: 4 }}>🔔 Reminder</span>
                {(c.projectId || c.pipelineId) && <div className="customer-meta" style={{ marginTop: 4 }}>For {jobTitleOf(c)}</div>}
              </>
            ) : (
              c.category && <span className="role-badge" style={{ marginTop: 4 }}>{c.category}</span>
            )}
            {c._kind === "reminder" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                <button className="btn btn-secondary" onClick={() => followUpReminder(c)}>Follow Up (2 Weeks)</button>
                <button className="btn btn-primary" onClick={() => completeReminder(c)}>Complete</button>
              </div>
            )}
            {c._kind === "project" && isClosedWithCheckIn(c) && c.ownerId === uid && (
              <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                <ClosedCheckInActions
                  project={c}
                  compact
                  byName={myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : auth.currentUser?.email}
                  onDone={(msg) => { showToast(msg); loadCustomers(uid, role === "admin"); }}
                />
              </div>
            )}
            {c._kind === "pipeline" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                <button className="btn btn-secondary" onClick={() => snoozePipelineFollowUp(c)}>Snooze 3 Months</button>
                <button className="btn btn-secondary" onClick={() => pipelineFollowUpAnotherYear(c)}>Follow Up in 1 Year</button>
              </div>
            )}
          </div>
  );

  // One reminder card for My Projects -- same card shape and overdue /
  // due-soon edge color as a project, with its own Follow Up and Complete.
  const renderReminderCard = (r) => {
    const days = reminderDaysAway(r);
    let barClass = "badge-bar-ok";
    if (days <= 0) barClass = "badge-bar-overdue";
    else if (days <= 2) barClass = "badge-bar-soon";

    return (
      <div
        key={`reminder-${r.id}`}
        className={`customer-card ${barClass}`}
        onClick={() => setCalendarPopup({ ...r, _kind: "reminder", projectName: r.subject, nextCheckIn: r.date })}
        style={{ cursor: "pointer" }}
      >
        <div className="customer-card-left">
          <div className="customer-name">{r.subject}</div>
          <span className="role-badge" style={{ marginTop: 6 }}>🔔 Reminder</span>
          {(r.projectId || r.pipelineId) && <div className="customer-meta" style={{ marginTop: 4 }}>For {jobTitleOf(r)}</div>}
          <div className="customer-dates">Due: {r.date}</div>
        </div>
        <div className="customer-card-middle customer-notes-preview">
          {r.notes ? <div style={{ whiteSpace: "pre-wrap" }}>{r.notes}</div> : <div className="private-note-hint">No notes</div>}
        </div>
        <div className="customer-card-right" onClick={e => e.stopPropagation()}>
          <button className="btn btn-secondary" onClick={() => followUpReminder(r)}>Follow Up (2 Weeks)</button>
          <button className="btn btn-primary" onClick={() => completeReminder(r)}>Complete</button>
          <button className="btn btn-secondary" onClick={() => openEditReminder(r)}>Edit</button>
        </div>
      </div>
    );
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

  const allPendingRequests = Object.entries(requestsById).flatMap(([customerId, reqs]) =>
    reqs.map(r => ({ ...r, customerId }))
  );
  const unreadNotificationCount = notifications.filter(n => !n.read).length;
  const alertsCount = allPendingRequests.length + unreadNotificationCount;

  return (
    <div className="dashboard-page">

      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} profile={myProfile ? { ...myProfile, role } : null} currentView={view} onSelectView={setView} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">CRM Dashboard</h1>
        </div>
        <div className="dashboard-header-actions">
          {role === "admin" && (
            <button
              className="btn btn-secondary hide-with-mobile-nav"
              onClick={() => setView(view === "admin" ? "personal" : "admin")}
            >
              {view === "admin" ? "Back to My Projects" : "Admin Settings"}
            </button>
          )}

          <div className="alerts-menu">
            {/* Opens on hover with a mouse, on tap on touch screens (TouchMenus). */}
            <button className="avatar-circle" style={{ position: "relative" }} aria-label="Alerts">
              🔔
              {alertsCount > 0 && <span className="alerts-badge">{alertsCount}</span>}
            </button>
            <div className="alerts-dropdown">
                <div className="avatar-dropdown-card alerts-card">
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
                            document.querySelectorAll(".alerts-menu.is-open").forEach(m => m.classList.remove("is-open"));
                            router.push(n.link);
                          }
                        }}
                      >
                        <div>{n.message}</div>
                        <div className="notes-history-date">{(n.createdAt || "").slice(0, 16).replace("T", " ")}</div>
                      </div>
                    ))}
                  </div>

                  <button
                    className="btn btn-secondary btn-block"
                    style={{ marginTop: 12 }}
                    onClick={() => router.push("/dashboard/alerts")}
                  >
                    See All Alerts
                  </button>
                </div>
              </div>
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
                <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={() => setExportFor({ self: true })}>
                  Export My Data
                </button>
                <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={logout}>
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {exportFor && myProfile && (
        <ExportDataModal
          viewer={{ id: uid, ...myProfile }}
          target={exportFor.target}
          onClose={() => setExportFor(null)}
        />
      )}

      {showUserSettings && myProfile && (
        <UserSettingsModal
          uid={uid}
          profile={myProfile}
          onClose={() => setShowUserSettings(false)}
          onSaved={(patch) => {
            setMyProfile(prev => ({ ...(prev || {}), ...patch }));
            showToast("Settings saved");
          }}
        />
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
                My Projects
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

          <button className="tab-btn" onClick={() => router.push("/dashboard/reminders")}>Reminders</button>

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
                      <a className="tab-dropdown-item" onClick={() => router.push(`/dashboard/directory?category=${encodeURIComponent(OWNER_CATEGORY)}`)}>Owners & Building Engineers</a>
                    </>
                  )}
                  {myPermissions.towers && (
                    <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory/towers")}>Installed Towers</a>
                  )}
                  {myPermissions.products && (
                    <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory/products")}>Product Options</a>
                  )}
                </div>
              </div>
            </div>
          )}

          {canViewAnalytics(myProfile) && (
            <button className="tab-btn" onClick={() => router.push("/dashboard/analytics")}>
              Analytics
            </button>
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

          <div className="header-tools">
            <GlobalSearch customers={customers} pipelineEntries={pipelineEntries} companies={companies} contacts={contacts} />
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
                          key={`${c._kind}-${c.id}`}
                          className={`calendar-event-pill ${c._kind === "reminder" ? "calendar-event-pill-reminder" : ""} ${isOverdueItem(c) ? "calendar-event-pill-overdue" : ""}`}
                          onClick={(e) => { e.stopPropagation(); openCalendarItem(c); }}
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

          {/* Phones get a scrolling day-by-day agenda instead of the grid
              (CSS switches between them by screen width). */}
          <div className="calendar-agenda">
            {calendarDays.every(({ key }) => !(projectsByDay[key] || []).length) && (
              <p className="private-note-hint">Nothing due in the next 4 weeks.</p>
            )}
            {calendarDays.map(({ date, key, isToday }) => {
              const dayItems = projectsByDay[key] || [];
              if (!dayItems.length && !isToday) return null;
              return (
                <section key={key} className={`agenda-day ${isToday ? "agenda-day-today" : ""}`}>
                  <h3 className="agenda-day-title">
                    {date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                    {isToday && <span className="role-badge role-badge-admin">Today</span>}
                  </h3>
                  {dayItems.length === 0 ? (
                    <p className="private-note-hint" style={{ margin: 0 }}>Nothing due today.</p>
                  ) : dayItems.map(renderCalendarItem)}
                </section>
              );
            })}
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

            {remindersError && (
              <p className="private-note-hint" style={{ color: "#dc2626" }}>⚠ Couldn't load your reminders: {remindersError}</p>
            )}

            {panelProjects.length === 0 && (
              <p className="private-note-hint">Nothing due.</p>
            )}

            {panelProjects.map(renderCalendarItem)}
          </div>
        </div>
      )}

      {view === "personal" && role !== "estimating" && (
        <>
          <MyScorecard pipelineEntries={pipelineEntries} projects={customers} uid={uid} />

          <div className="list-toolbar">
            <button
              className={`btn btn-secondary ${anyActive(personalFilters) ? "has-filters" : ""}`}
              onClick={() => setOpenFilters(prev => ({ ...prev, personal: !prev.personal }))}
            >
              Filters{anyActive(personalFilters) ? ` (${Object.values(personalFilters).filter(isFilterActive).length})` : ""}
            </button>
            <button className="btn btn-primary list-toolbar-add" onClick={() => router.push("/dashboard/project/new")}>ADD PROJECT</button>
          </div>

          {(openFilters.personal || anyActive(personalFilters)) && (
            <FilterBar
              idPrefix="personal-filter"
              filters={personalFilterDefs}
              values={personalFilters}
              onChange={setFilter(setPersonalFilters)}
              onClear={() => setPersonalFilters({})}
              resultCount={filteredCustomers.length}
              resultNoun={filteredCustomers.length === 1 ? "project" : "projects"}
            />
          )}

          {/* SEARCH */}


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
                      <FirmTypeSelect id={`edit-project-type-${c.id}`} value={editData.companyCategory} onChange={v => setEditData({ ...editData, companyCategory: v })} />
                      <CompanyContactFields
                        idPrefix={`edit-project-${c.id}`}
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

                      <BuildingSectorSelect id={`edit-project-sector-${c.id}`} value={editData.buildingSector} onChange={v => setEditData({ ...editData, buildingSector: v })} />
                      <WorkTypeSelect id={`edit-project-work-type-${c.id}`} value={editData.workType} onChange={v => setEditData({ ...editData, workType: v })} />

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
                  {c.buildingSector && <div className="customer-meta" style={{ marginTop: 4 }}>Sector: {c.buildingSector}</div>}
                      {c.projectValue && <div className="customer-meta" style={{ marginTop: 4 }}>Value: {c.projectValue}</div>}
                  {c.workType && <div className="customer-meta" style={{ marginTop: 4 }}>{c.workType}</div>}

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
                          <DeleteRecordButton
                            kind="project"
                            id={c.id}
                            name={c.projectName || c.company || "Untitled project"}
                            onDeleted={() => {
                              setEditingId(null);
                              setSelected(null);
                              showToast("Project deleted");
                              loadCustomers(uid, role === "admin");
                            }}
                          />
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
            ...customers
              .filter(c => c.ownerId === uid && isClosedWithCheckIn(c) && isCheckInDue(c))
              .map(c => ({
                sortKey: getDateValue(c.nextCheckIn),
                element: (
                  <div
                    key={`closed-checkin-${c.id}`}
                    className="customer-card badge-bar-overdue"
                    onClick={() => router.push(`/dashboard/project/${c.id}`)}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="customer-card-left">
                      <div className="customer-name">{c.projectName || c.company}</div>
                      {c.company && c.projectName && c.projectName !== c.company && <div className="customer-contact">{c.company}</div>}
                      <span className="role-badge" style={{ marginTop: 6 }}>Closed project check-in</span>
                      <div className="customer-dates">Due: {formatDate(c.nextCheckIn)}</div>
                    </div>
                    <div className="customer-card-middle">
                      <div className="private-note-hint">Follow up with {c.contact || "the customer"} to see how things are going, then log it with Update.</div>
                    </div>
                    <div className="customer-card-right" onClick={e => e.stopPropagation()}>
                      <ClosedCheckInActions
                        project={c}
                        byName={myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : auth.currentUser?.email}
                        onDone={(msg) => { showToast(msg); loadCustomers(uid, role === "admin"); }}
                      />
                    </div>
                  </div>
                )
              })),
            ...activeReminders
              .map(r => ({ sortKey: fromLocalDateKey(r.date).getTime(), element: renderReminderCard(r) })),
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
                    {p.buildingSector && <div className="customer-meta" style={{ marginTop: 4 }}>Sector: {p.buildingSector}</div>}
                    {p.value && <div className="customer-meta" style={{ marginTop: 4 }}>Value: {p.value}</div>}
                    {p.workType && <div className="customer-meta" style={{ marginTop: 4 }}>{p.workType}</div>}
                  </div>
                  <div className="customer-card-middle">
                    {p.company && <div className="private-note-hint">{p.company}</div>}
                    {p.bidDate && <div className="customer-dates">Bid: {p.bidDate}</div>}
                  </div>
                </div>
              )
            }))
          ].sort((a, b) => a.sortKey - b.sortKey).map(item => item.element)}

          {remindersError && (
            <p className="private-note-hint" style={{ color: "#dc2626" }}>⚠ Couldn't load your reminders: {remindersError}</p>
          )}

          {filteredCustomers.length === 0 && myPipelineEntries.length === 0 && activeReminders.length === 0 && (
            <p className="private-note-hint">
              {anyActive(personalFilters) ? "No projects match these filters." : "Nothing on your dashboard yet."}
            </p>
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


          <FilterBar
            idPrefix="team-filter"
            filters={teamFilterDefs}
            values={teamFilters}
            onChange={setFilter(setTeamFilters)}
            onClear={() => setTeamFilters({})}
            resultCount={teamCustomers.length}
            resultNoun={teamCustomers.length === 1 ? "project" : "projects"}
          />

          {teamCustomers.length === 0 && (
            <p className="private-note-hint">{anyActive(teamFilters) ? "No projects match these filters." : "No projects yet."}</p>
          )}

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
                  {c.buildingSector && <div className="customer-meta" style={{ marginTop: 4 }}>Sector: {c.buildingSector}</div>}
                  {c.projectValue && <div className="customer-meta" style={{ marginTop: 4 }}>Value: {c.projectValue}</div>}
                  {c.workType && <div className="customer-meta" style={{ marginTop: 4 }}>{c.workType}</div>}
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
          {/* Estimating's My Projects is the pipeline list, so their
              reminders get their own section on top of it instead. */}
          {view === "personal" && <MyScorecard pipelineEntries={pipelineEntries} projects={customers} uid={uid} />}

          {view === "personal" && (
            <div style={{ marginBottom: 24 }}>
              <h3 className="modal-title" style={{ marginBottom: 12 }}>My Reminders</h3>
              {remindersError && (
                <p className="private-note-hint" style={{ color: "#dc2626" }}>⚠ Couldn't load your reminders: {remindersError}</p>
              )}
              {!remindersError && activeReminders.length === 0 && (
                <p className="private-note-hint">No reminders. Add one on the Reminders page.</p>
              )}
              {[...activeReminders]
                .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
                .map(renderReminderCard)}
            </div>
          )}

          <div className="list-toolbar">
            <button
              className={`btn btn-secondary ${anyActive(pipelineFilters) ? "has-filters" : ""}`}
              onClick={() => setOpenFilters(prev => ({ ...prev, pipeline: !prev.pipeline }))}
            >
              Filters{anyActive(pipelineFilters) ? ` (${Object.values(pipelineFilters).filter(isFilterActive).length})` : ""}
            </button>
            <button className="btn btn-primary list-toolbar-add" onClick={() => router.push("/dashboard/pipeline/new")}>ADD PIPELINE ENTRY</button>
          </div>

          {(openFilters.pipeline || anyActive(pipelineFilters)) && (
            <FilterBar
              idPrefix="pipeline-filter"
              filters={pipelineFilterDefs}
              values={pipelineFilters}
              onChange={setFilter(setPipelineFilters)}
              onClear={() => setPipelineFilters({})}
              resultCount={filteredPipeline.length}
              resultNoun={filteredPipeline.length === 1 ? "entry" : "entries"}
            />
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
                {p.buildingSector && <div className="customer-meta" style={{ marginTop: 4 }}>Sector: {p.buildingSector}</div>}
                {p.value && <div className="customer-meta" style={{ marginTop: 4 }}>Value: {p.value}</div>}
                {p.workType && <div className="customer-meta" style={{ marginTop: 4 }}>{p.workType}</div>}
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
            <p className="private-note-hint">{anyActive(pipelineFilters) ? "No pipeline entries match these filters." : "No pipeline entries yet."}</p>
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

          <FilterBar
            idPrefix="past-filter"
            filters={pastFilterDefs}
            values={pastFilters}
            onChange={setFilter(setPastFilters)}
            onClear={() => setPastFilters({})}
            resultCount={pastProjectsList.length + pastPipelineList.length}
            resultNoun={pastProjectsList.length + pastPipelineList.length === 1 ? "result" : "results"}
          />

          {pastFilters.show !== "pipeline" && (
            <>
              <h3 className="modal-title" style={{ marginTop: 8, marginBottom: 12 }}>Closed Projects</h3>
              {pastProjectsList.length === 0 && (
                <p className="private-note-hint">{anyActive(pastFilters) || pastProjectsSearch.trim() ? "No closed projects match these filters." : "No closed projects yet."}</p>
              )}
            </>
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
                <span className="role-badge" style={{ marginTop: 6 }}>
                  {/* A closed project with a future alert on file (Won awaiting
                      start, or Prospecting Only awaiting its next check-in)
                      isn't done for good -- it's just parked until then. */}
                  {c.closedOutcome === "Prospecting Only" && c.nextCheckIn ? "Temporarily Closed" : c.category}
                </span>
                {c.closedOutcome && c.closedOutcome !== CLOSED_OUTCOME && (
                  <span className={`role-badge ${c.closedOutcome === "Won" ? "role-badge-admin" : ""}`} style={{ marginTop: 4 }}>
                    {c.closedOutcome}
                  </span>
                )}
                {isClosedWithCheckIn(c) && c.nextCheckIn && (
                  <div className="customer-dates">Next check-in: {formatDate(c.nextCheckIn)}</div>
                )}
              </div>
              <div className="customer-card-middle">
                {c.company && <div className="private-note-hint">{c.company}</div>}
                <div className="private-note-hint">Owned by {ownerLabel(c.ownerId)}</div>
                {c.closedOutcome === "Lost" ? (() => {
                  const { reason, winner } = lostInfoOf(c);
                  return (
                    <>
                      {closedDateOf(c) && <div className="customer-dates">Lost: {closedDateOf(c).slice(0, 10)}</div>}
                      <div className="private-note-hint" style={{ whiteSpace: "pre-wrap" }}>
                        <strong>Why:</strong> {reason || "No reason recorded"}
                      </div>
                      <div className="private-note-hint"><strong>Won by:</strong> {winner || "Not recorded"}</div>
                    </>
                  );
                })() : (
                  closedDateOf(c) && <div className="customer-dates">Closed: {closedDateOf(c).slice(0, 10)}</div>
                )}
              </div>
            </div>
          ))}

          {pastFilters.show !== "projects" && (
            <>
              <h3 className="modal-title" style={{ marginTop: 28, marginBottom: 12 }}>Resolved Pipeline Entries</h3>
              {pastPipelineList.length === 0 && (
                <p className="private-note-hint">{anyActive(pastFilters) || pastProjectsSearch.trim() ? "No pipeline entries match these filters." : "No resolved pipeline entries yet."}</p>
              )}
            </>
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
                  {p.outcome === "Won" ? "✅ Won" : p.outcome === "Did Not Bid" ? "🚫 DID NOT BID" : "❌ Lost"}
                </span>
              </div>
              <div className="customer-card-middle">
                {p.company && <div className="private-note-hint">{p.company}</div>}
                {p.outcome === "Won" && p.wonByContractor && (
                  <div className="private-note-hint">Awarded to {p.wonByContractor}</div>
                )}
                <div className="private-note-hint">Owned by {ownerLabel(p.ownerId)}</div>
                {p.resolvedAt && <div className="customer-dates">{p.outcome}: {p.resolvedAt.slice(0, 10)}</div>}
                {(p.outcome === "Lost" || p.outcome === "Did Not Bid") && (
                  <>
                    <div className="private-note-hint" style={{ whiteSpace: "pre-wrap" }}>
                      <strong>Why:</strong> {p.lostReason || "No reason recorded"}
                    </div>
                    <div className="private-note-hint"><strong>Won by:</strong> {p.lostTo || "Not recorded"}</div>
                  </>
                )}
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

          <div className="admin-card add-user-card">
            <div>
              <h3 className="modal-title" style={{ margin: 0 }}>Team Accounts</h3>
              <p className="modal-subtitle" style={{ margin: "2px 0 0" }}>New users get an email to set their own password.</p>
            </div>
            <button className="btn btn-primary" onClick={() => setShowAddUser(true)}>+ Add User</button>
          </div>

          <div className="admin-card">
            <h3 className="modal-title">Team Members</h3>

            <table className="admin-table team-table stack-on-phone">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Access</th>
                  <th><span className="sr-only">Edit</span></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td data-label="Name">
                      {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : (
                        <span className="private-note-hint">Not set yet</span>
                      )}
                    </td>
                    <td data-label="Email" className="team-table-email">{u.email}{u.id === uid ? " (You)" : ""}</td>
                    <td data-label="Role">
                      <span className={`role-badge ${u.role === "admin" ? "role-badge-admin" : ""}`}>
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td data-label="Status">{u.disabled ? "Deactivated" : "Active"}</td>
                    <td data-label="Access">{accessSummary(u)}</td>
                    <td data-label="" className="team-table-edit">
                      {u.id === uid ? (
                        <span className="private-note-hint" style={{ margin: 0 }} title="Another admin manages your account">That's you</span>
                      ) : (
                        <button className="btn btn-secondary btn-small" onClick={() => setEditUserTarget(u)}>Edit User</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      {showAddUser && (
        // No backdrop click, ✕, or Escape: this only closes through Add User
        // or Cancel, so a half-filled account is never left behind.
        <div className="modal-overlay">
          <div className="modal-card add-user-modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
            <h3 id="add-user-title" className="modal-title">Add User</h3>
            <p className="modal-subtitle" style={{ marginBottom: 12 }}>
              They'll get an email to set their own password.
              {(!newUserFirstName || !newUserLastName) && " If you skip the name fields, they'll be asked for it on first login."}
            </p>

            <label className="field-label" htmlFor="new-user-first">First Name (optional)</label>
            <input
              id="new-user-first"
              className="field"
              name="newUserFirstName"
              autoComplete="off"
              placeholder="First name"
              value={newUserFirstName}
              onChange={e => setNewUserFirstName(e.target.value)}
            />

            <label className="field-label" htmlFor="new-user-last">Last Name (optional)</label>
            <input
              id="new-user-last"
              className="field"
              name="newUserLastName"
              autoComplete="off"
              placeholder="Last name"
              value={newUserLastName}
              onChange={e => setNewUserLastName(e.target.value)}
            />

            <label className="field-label" htmlFor="new-user-email">Email</label>
            <input
              id="new-user-email"
              className="field"
              type="email"
              name="newUserEmail"
              autoComplete="off"
              placeholder="name@company.com"
              value={newUserEmail}
              onChange={e => setNewUserEmail(e.target.value)}
            />

            <label className="field-label" htmlFor="new-user-role">Role</label>
            <select id="new-user-role" className="field" value={newUserRole} onChange={e => setNewUserRole(e.target.value)}>
              <option value="member">Salesperson</option>
              <option value="estimating">Estimating Department</option>
              <option value="admin">Admin</option>
            </select>

            <label className="field-label" style={{ marginTop: 8 }}>Permissions</label>
            {PERMISSION_DEFS.map(p => {
              const always = (p.alwaysForRoles || []).includes(newUserRole);
              return (
                <label key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: always ? "default" : "pointer" }}>
                  <input
                    type="checkbox"
                    disabled={always}
                    checked={always || !!newUserPermissions[p.key]}
                    onChange={() => setNewUserPermissions(prev => ({ ...prev, [p.key]: !prev[p.key] }))}
                  />
                  {p.label}
                  {always && <span className="private-note-hint" style={{ margin: 0 }}>(always on for this role)</span>}
                </label>
              );
            })}

            <div className="modal-actions add-user-actions">
              <button className="btn btn-secondary" disabled={creatingUser} onClick={cancelAddUser}>Cancel</button>
              <button className="btn btn-primary" disabled={creatingUser} onClick={createUser}>
                {creatingUser ? "Adding…" : "Add User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editUserTarget && (
        <EditUserModal
          user={editUserTarget}
          ownedCounts={{
            projects: customers.filter(c => c.ownerId === editUserTarget.id).length,
            pipeline: pipelineEntries.filter(p => p.ownerId === editUserTarget.id).length
          }}
          onClose={() => setEditUserTarget(null)}
          onExport={(u) => { setEditUserTarget(null); setExportFor({ target: u }); }}
          onChanged={async (message, { deleted } = {}) => {
            showToast(message);
            await loadUsers();
            if (deleted) {
              await loadCustomers(uid, true);
              await loadPipeline();
            }
          }}
        />
      )}

      {/* COMPLETED POPUP */}
      {completedTarget && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3 className="modal-title">Mark Completed</h3>
            <p className="modal-subtitle" style={{ marginBottom: 12 }}>
              {completedOutcome === "Won" && "The project stays on My Projects as an Ongoing Project, due on the date below."}
              {completedOutcome === CLOSED_OUTCOME && "The project moves to Past Projects. You'll get a check-in reminder in 1 year to follow up with the customer."}
              {completedOutcome !== "Won" && completedOutcome !== CLOSED_OUTCOME && "This closes the project out and moves it to Past Projects. "}
              {completedOutcome === "Lost" && "No further alerts -- it stays in Past Projects until someone moves it back."}
              {completedOutcome === "Not Pursuing" && "No further alerts -- it stays in Past Projects until someone moves it back."}
              {completedOutcome === "Prospecting Only" && "You'll be alerted and it'll move back to My Projects on the date below to reach out to the contractor."}
            </p>

            <label className="field-label">Outcome</label>
            <select className="field" value={completedOutcome} onChange={e => setCompletedOutcome(e.target.value)}>
              <option value="Won">Job Won</option>
              <option value={CLOSED_OUTCOME}>Project Closed</option>
              <option value="Lost">Job Lost</option>
              <option value="Not Pursuing">Not Pursuing Anymore</option>
              <option value="Prospecting Only">Prospecting Only</option>
            </select>

            {completedOutcome === "Won" && (
              <div style={{ marginTop: 10 }}>
                <label className="field-label" htmlFor="won-next-date">Next Due Date</label>
                <input id="won-next-date" className="field" type="date" value={wonNextDate} onChange={e => setWonNextDate(e.target.value)} />
              </div>
            )}

            {completedOutcome === "Lost" && (
              <div style={{ marginTop: 10 }}>
                <label className="field-label" htmlFor="lost-reason">Why was it lost?</label>
                <textarea id="lost-reason" className="field" style={{ width: "100%", height: 70 }} value={lostNotes} onChange={e => setLostNotes(e.target.value)} />
                <label className="field-label" htmlFor="lost-to">Who won it? (optional)</label>
                <FirmSelect id="lost-to" companies={companies} category="Contractor" value={lostTo} onChange={setLostTo} placeholder="Select or search firm..." newLabel="firm" />
              </div>
            )}

            {completedOutcome === "Prospecting Only" && (
              <div style={{ marginTop: 10 }}>
                <label className="field-label">Next Alert Date</label>
                <input className="field" type="date" value={prospectingNextDate} onChange={e => setProspectingNextDate(e.target.value)} />
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={confirmCompleted}>Confirm</button>
              <button className="btn btn-secondary" onClick={() => setCompletedTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* HOME CALENDAR QUICK VIEW */}
      {calendarPopup && (() => {
        const c = calendarPopup;
        const link = calendarItemLink(c);
        const due = String(formatDate(c.nextCheckIn) || "").slice(0, 10);
        const isOwnerOfProject = c._kind === "project" && c.ownerId === uid;
        const kindLabel = c._kind === "reminder"
          ? "Reminder"
          : c._kind === "bid" ? `Bid date · ${c.stage || "Pipeline"}`
          : c._kind === "pipeline" ? "Won — check in"
          : isClosedWithCheckIn(c) ? "Closed project check-in"
          : (c.category || "Project check-in");
        return (
          <div className="modal-overlay" onClick={() => setCalendarPopup(null)}>
            <div className="modal-card calendar-popup" role="dialog" aria-modal="true" aria-labelledby="calendar-popup-title" onClick={e => e.stopPropagation()}>
              <button className="modal-close" aria-label="Close" onClick={() => setCalendarPopup(null)}>✕</button>
              <span className={`role-badge ${c._kind === "reminder" ? "" : "role-badge-admin"}`}>{kindLabel}</span>
              <h3 id="calendar-popup-title" className="modal-title" style={{ margin: "8px 0 2px" }}>{c.projectName || c.company}</h3>
              {c.company && c.projectName && c.projectName !== c.company && (
                <p className="modal-subtitle" style={{ margin: 0 }}>{c.company}</p>
              )}

              <dl className="detail-list calendar-popup-details">
                <dt>{c._kind === "bid" ? "Bid date" : "Due"}</dt>
                <dd>
                  {due || "—"}
                  {isOverdueItem(c) && <span className="calendar-overdue-tag">Overdue</span>}
                </dd>
                {c._kind !== "reminder" && c.projectAddress && (<><dt>Address</dt><dd>{c.projectAddress}</dd></>)}
                {c._kind === "project" && c.contact && (<><dt>Contact</dt><dd>{[c.contact, formatPhone(c.phone)].filter(Boolean).join(" · ")}</dd></>)}
                {c._kind === "project" && c.ownerId !== uid && (<><dt>Owner</dt><dd>{ownerLabel(c.ownerId)}</dd></>)}
                {(c._kind === "bid" || c._kind === "pipeline") && c.value && (<><dt>Value</dt><dd>{c.value}</dd></>)}
                {c._kind === "project" && c.projectValue && (<><dt>Value</dt><dd>{c.projectValue}</dd></>)}
                {c.workType && c._kind !== "reminder" && (<><dt>Work type</dt><dd>{c.workType}</dd></>)}
              </dl>
              {c._kind === "reminder" && c.notes && (
                <p className="calendar-popup-notes">{c.notes}</p>
              )}
              {c._kind === "reminder" && link && (
                <p className="calendar-popup-job">
                  For{" "}
                  <a className="link-muted" href={link} onClick={e => { e.preventDefault(); setCalendarPopup(null); router.push(link); }}>
                    {jobTitleOf(c)}
                  </a>
                </p>
              )}

              <div className="calendar-popup-actions">
                {c._kind === "reminder" && (
                  <>
                    <button className="btn btn-secondary" onClick={fromPopup(followUpReminder)}>Follow Up (2 Weeks)</button>
                    <button className="btn btn-primary" onClick={fromPopup(completeReminder)}>Complete</button>
                    <button className="btn btn-secondary" onClick={fromPopup(openEditReminder)}>Edit</button>
                  </>
                )}
                {c._kind === "project" && !isClosedWithCheckIn(c) && isOwnerOfProject && (
                  <>
                    <button className="btn btn-secondary" onClick={fromPopup(handleFollowUp)}>Follow Up (2 Weeks)</button>
                    <button className="btn btn-primary" onClick={fromPopup(openCompletedPopup)}>Complete</button>
                  </>
                )}
                {c._kind === "project" && isClosedWithCheckIn(c) && isOwnerOfProject && (
                  <ClosedCheckInActions
                    project={c}
                    compact
                    byName={myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : auth.currentUser?.email}
                    onDone={(msg) => { setCalendarPopup(null); showToast(msg); loadCustomers(uid, role === "admin"); }}
                  />
                )}
                {c._kind === "pipeline" && (
                  <>
                    <button className="btn btn-secondary" onClick={fromPopup(snoozePipelineFollowUp)}>Snooze 3 Months</button>
                    <button className="btn btn-secondary" onClick={fromPopup(pipelineFollowUpAnotherYear)}>Follow Up in 1 Year</button>
                  </>
                )}
              </div>
              {c._kind === "project" && !isOwnerOfProject && (
                <p className="private-note-hint" style={{ marginBottom: 0 }}>Only {ownerLabel(c.ownerId)} can follow up on or complete this project.</p>
              )}

              {link && (
                <div className="calendar-popup-footer">
                  <button className="btn btn-secondary" onClick={() => { setCalendarPopup(null); router.push(link); }}>
                    {(c._kind === "project" || c.projectId) ? "Open project page →" : "Open pipeline entry →"}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {reminderForm && (
        <div className="modal-overlay" onClick={() => setReminderForm(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setReminderForm(null)}>✕</button>
            <h3 className="modal-title">{reminderForm.id ? "Reminder" : "Add Reminder"}</h3>
            <p className="modal-subtitle" style={{ marginBottom: 12 }}>Only you can see your reminders.</p>

            <label className="field-label" htmlFor="reminder-subject">Subject</label>
            <input
              id="reminder-subject"
              className="field"
              autoComplete="off"
              autoFocus
              value={reminderForm.subject}
              onChange={e => setReminderForm({ ...reminderForm, subject: e.target.value })}
              onKeyDown={e => { if (e.key === "Enter") saveReminder(); }}
            />

            <label className="field-label" htmlFor="reminder-date">Date</label>
            <input
              id="reminder-date"
              className="field"
              type="date"
              value={reminderForm.date}
              onChange={e => setReminderForm({ ...reminderForm, date: e.target.value })}
            />

            <label className="field-label" htmlFor="reminder-job">Attach to a job (optional)</label>
            <JobPicker id="reminder-job" options={reminderJobOptions} value={reminderForm.job || ""} onChange={v => setReminderForm({ ...reminderForm, job: v })} />
            {reminderForm.job && !reminderJobOptions.some(o => o.key === reminderForm.job) && (
              <p className="private-note-hint" style={{ margin: "4px 0 0" }}>
                Attached to {jobTitleOf({ projectId: reminderForm.job.startsWith("project:") ? reminderForm.job.slice(8) : null, pipelineId: reminderForm.job.startsWith("pipeline:") ? reminderForm.job.slice(9) : null })} (no longer active).{" "}
                <button type="button" className="link-muted" style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }} onClick={() => setReminderForm({ ...reminderForm, job: "" })}>Remove</button>
              </p>
            )}

            <label className="field-label" htmlFor="reminder-notes">Notes (optional)</label>
            <textarea
              id="reminder-notes"
              className="field"
              style={{ width: "100%", height: 90 }}
              value={reminderForm.notes}
              onChange={e => setReminderForm({ ...reminderForm, notes: e.target.value })}
            />

            <div className="modal-actions">
              <button className="btn btn-primary" disabled={savingReminder} onClick={saveReminder}>
                {savingReminder ? "Saving..." : reminderForm.id ? "Save Changes" : "Add Reminder"}
              </button>
              {reminderForm.id && (
                <>
                  <button className="btn btn-secondary" onClick={() => followUpReminder(reminders.find(r => r.id === reminderForm.id))}>Follow Up (2 Weeks)</button>
                  <button className="btn btn-secondary" onClick={() => completeReminder(reminders.find(r => r.id === reminderForm.id))}>Complete</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
