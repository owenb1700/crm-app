"use client";

import { useEffect, useState, useMemo, useRef } from "react";
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
import { ensureCompanyAndContactBatch, OWNER_CATEGORY, firmTypeOf, BUILDING_SECTORS, WORK_TYPES } from "../../lib/directory";
import { isPipelineBidAlertFor, isWonFollowUpFor, isProjectCheckInFor, isPipelineCheckInFor, wasMineOnPipeline, wasMineOnProject } from "../../lib/alertRecipients";
import { bidderDirectoryEntries } from "../../lib/bidders";
import JobPicker from "../components/JobPicker";
import { RECORDS_CHANGED_EVENT } from "../components/TrashModal";
import { withoutTrashed, reminderJobIsActive } from "../../lib/trash";
import UserSettingsModal from "../components/UserSettingsModal";
import FilterBar, { matchesDateFilter, optionsFrom, isFilterActive } from "../components/FilterBar";
import { canViewAnalytics, withDollar } from "../../lib/analytics";
import ClosedCheckInActions from "../components/ClosedCheckInActions";
import PipelineMyAlerts from "../components/PipelineMyAlerts";
import PipelineNotes from "../components/PipelineNotes";
import MyScorecard from "../components/MyScorecard";
import ExportDataModal from "../components/ExportDataModal";
import { CLOSED_OUTCOME, closeProjectPayload, isClosedWithCheckIn, isCheckInDue, yearsFrom, localDateKey } from "../../lib/closedProjects";
import { ensureTowerModel } from "../../lib/towerModels";
import MobileNav from "../components/MobileNav";
import { LeadTimeSummary } from "../components/LeadTimeFields";
import EditUserModal from "../components/EditUserModal";
import { PERMISSION_DEFS, DEFAULT_PERMISSIONS, defaultPermissionsFor, roleLabel, accessSummary, canEnterForOthers } from "../../lib/permissions";
import { FirmSelect } from "../components/DirectoryPickers";
import ViewTabs from "../components/ViewTabs";
import RecordNotes from "../components/RecordNotes";
import { buildCalendarWeeks, weekendColumnsFor, visibleCalendarDays, columnLabels, startOfWeek, dateKey, calendarKeyFor as calendarDayKeyFor } from "../../lib/calendarDays";
import CalendarNav from "../components/CalendarNav";
import { resolvedBidItems, outcomeItems, activityItems, leadTimeItems, doneReminderItems, dedupeByDay } from "../../lib/calendarHistory";
import { leadTimeStatus, todayKey } from "../../lib/leadTimes";
import { hasShare, splitShares } from "../../lib/splits";
import { isOnMyPipelineList } from "../../lib/pipelinePeople";
import { notifyUsers } from "../../lib/notify";
import { exportDashboardView } from "../../lib/viewExport";
import ExportButtons from "../components/ExportButtons";
import SortPicker from "../components/SortPicker";
import { sortRows, sortMixed } from "../../lib/sorting";
import Icon from "../components/Icon";
import ConfirmDialog from "../components/ConfirmDialog";
import { completedPayload, isOpen, doneOnly } from "../../lib/reminders";
import { PROJECT_CATEGORIES as CATEGORY_OPTIONS, PRE_BID, normalizeCategory, nextStage, nextStageLabel, stageNeedsInput } from "../../lib/projectCategories";
import { normalizeStage, nextPipelineStep, nextPipelineStepLabel, pipelineStepNeedsInput, groupByBid,
  movedToPostBid, postBidCheckIn } from "../../lib/pipelineStages";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

// Parts moved to their own tab (/dashboard/parts), so they're no longer
// a project status. Projects filed as Parts before the move keep the
// label until someone changes it.



// A pipeline entry with one of these outcomes is finished and lives in
// Past Projects. Only Won ever gets a follow-up check-in.
const RESOLVED_PIPELINE_OUTCOMES = ["Won", "Lost", "Did Not Bid"];

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

// Tabs that can be opened directly with a #hash (e.g. /dashboard#pipeline).
// Home is in here too: every tab belongs in the URL, or Back has nothing
// to go back to.
const HASH_VIEWS = ["home", "personal", "pipeline", "team", "pastProjects", "admin"];

// Scroll positions survive leaving the dashboard, but not closing the tab:
// where you were reading is worth a moment, not a week.
const SCROLL_MEMORY = "dashboardScrollByView";

const readScrollMemory = () => {
  if (typeof window === "undefined") return {};
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(SCROLL_MEMORY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
};

const writeScrollMemory = (byView) => {
  try {
    window.sessionStorage.setItem(SCROLL_MEMORY, JSON.stringify(byView));
  } catch {
    // Private windows and blocked site data: the page works, it just
    // forgets where you were.
  }
};

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
  // Switching tabs used to be state only: no trace in the URL, no entry in
  // history. So Back from My Projects went wherever you were before the
  // dashboard entirely, and coming back from a project landed on Home at
  // the top of the page. The tab is part of the address now.
  //
  // The hash used to be stripped off again the moment it was read, which
  // is why Back forgot -- by the time anyone pressed it there was nothing
  // left to read.
  //
  // Where you were on each tab. Held in sessionStorage rather than in
  // React, because opening a project leaves this page entirely -- coming
  // back is a fresh mount with every ref gone, and that was the case that
  // sent you to the top of the list every time.
  const scrollByView = useRef(readScrollMemory());
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  // A scroll we caused ourselves isn't the user choosing a spot, so it
  // doesn't get written down.
  const holdUntil = useRef(0);
  const scrollTo = (y) => {
    holdUntil.current = Date.now() + 400;
    window.scrollTo(0, y);
  };

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame || Date.now() < holdUntil.current) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        scrollByView.current[viewRef.current] = window.scrollY;
        writeScrollMemory(scrollByView.current);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // On arrival the page is still empty -- the projects come from Firestore
  // a moment later -- so scrolling straight to the remembered spot lands
  // at the bottom of a page that isn't built yet. Wait until it's tall
  // enough to hold that spot, and give up after a couple of seconds in
  // case the list genuinely got shorter.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    const target = scrollByView.current[view];
    if (!target) { restored.current = true; return; }
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      if (room >= target || tries > 40) {
        if (room >= target) scrollTo(target);
        restored.current = true;
        clearInterval(id);
      }
    }, 50);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const openView = (name) => {
    if (name === view) return;
    // Where they were before leaving, so coming back lands there.
    scrollByView.current[view] = window.scrollY;
    scrollByView.current[name] = 0;
    writeScrollMemory(scrollByView.current);
    window.history.pushState({ view: name }, "", name === "home" ? window.location.pathname : `#${name}`);
    setView(name);
    scrollTo(0);
  };

  useEffect(() => {
    const readHash = () => {
      const hash = window.location.hash.slice(1);
      const next = HASH_VIEWS.includes(hash) ? hash : "home";
      setView(next);
      const y = scrollByView.current[next];
      if (typeof y === "number") requestAnimationFrame(() => scrollTo(y));
    };
    // Next.js only puts an arriving #hash on the URL after the first
    // render, so read it once more once it's on screen.
    const soon = setTimeout(readHash, 0);
    window.addEventListener("popstate", readHash);
    window.addEventListener("hashchange", readHash);
    return () => {
      clearTimeout(soon);
      window.removeEventListener("popstate", readHash);
      window.removeEventListener("hashchange", readHash);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const [parts, setParts] = useState([]);
  const [towerModels, setTowerModels] = useState([]);
  const [rebuildingDirectory, setRebuildingDirectory] = useState(false);

  // COLLABORATION
  const [requestsById, setRequestsById] = useState({}); // customerId -> pending requests on entries I own
  const [requestedIds, setRequestedIds] = useState(new Set()); // customerIds I've just requested (optimistic)

  // EDIT

  // MODAL
  const [selected, setSelected] = useState(null);

  // COMPLETED
  const [completedTarget, setCompletedTarget] = useState(null);
  const [toastBad, setToastBad] = useState(false);
  // Asking before something irreversible, in the page rather than in an OS
  // box that freezes everything behind it until it's dismissed.
  const [ask, setAsk] = useState(null);
  // One per form, said next to the button that was pressed.
  const [reminderProblem, setReminderProblem] = useState("");
  const [nameProblem, setNameProblem] = useState("");
  const [outcomeProblem, setOutcomeProblem] = useState("");
  const [newUserProblem, setNewUserProblem] = useState("");
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
  // My Projects shows three kinds of card; this narrows to one of them,
  // for the screen and for the export alike.
  const [personalType, setPersonalType] = useState(""); // "" | projects | pipeline | reminders
  // How each list is ordered. Due date first, since that's what people
  // work from.
  const [personalSort, setPersonalSort] = useState({ key: "due", direction: "asc" });
  const [pipelineSort, setPipelineSort] = useState({ key: "bid", direction: "asc" });
  const [teamSort, setTeamSort] = useState({ key: "due", direction: "asc" });
  const [pastSort, setPastSort] = useState({ key: "closed", direction: "desc" });

  // ADMIN: create user form
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("member");
  const [newUserFirstName, setNewUserFirstName] = useState("");
  const [newUserLastName, setNewUserLastName] = useState("");
  const [newUserPermissions, setNewUserPermissions] = useState(defaultPermissionsFor("member"));
  const [showAddUser, setShowAddUser] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [editUserTarget, setEditUserTarget] = useState(null);

  const col = collection(db, "customers");

  // `bad` is for something that failed. It reads red and stays longer,
  // because a failure people miss is worse than one they have to wait out.
  const showToast = (msg, bad = false) => {
    setToast(msg);
    setToastBad(bad);
    setTimeout(() => setToast(""), bad ? 8000 : 5000);
  };

  // A message left by another page right before sending someone here,
  // shown once. Nothing sets one at the moment -- Add Pipeline Entry used
  // to, before it started landing on the new entry instead -- but the
  // hand-off is here for whenever a page needs it.
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
    // Back to the Friday before, so it lands ahead of the weekend.
    if (day === 6) d.setDate(d.getDate() - 1);
    if (day === 0) d.setDate(d.getDate() - 2);
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
    // Parts come along for "Search everything" -- an address typed on a
    // parts order should be findable from here like any other.
    const [companiesSnap, contactsSnap, partsSnap] = await Promise.all([
      getDocs(collection(db, "companies")),
      getDocs(collection(db, "contacts")),
      getDocs(collection(db, "parts"))
    ]);
    setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setParts(partsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
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
    // Back to the Friday before, so an automatic follow-up shows up ahead
    // of the weekend rather than after it.
    if (next.getDay() === 6) next.setDate(next.getDate() - 1);
    if (next.getDay() === 0) next.setDate(next.getDate() - 2);
    return next;
  };

  const loadReminders = async (currentUid) => {
    const snap = await getDocs(query(collection(db, "reminders"), where("userId", "==", currentUid)));
    setReminders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    setRemindersError(null);
  };

  // A reminder's attached job as a JobPicker key ("project:<id>" / "pipeline:<id>").
  const openNewReminder = () => {
    setReminderForm({ subject: "", date: toLocalDateKey(new Date()), notes: "", job: "" });
  };

  const jobKeyOf = (r) =>
    (r.projectId ? `project:${r.projectId}` : r.pipelineId ? `pipeline:${r.pipelineId}` : r.partId ? `part:${r.partId}` : "");

  const openEditReminder = (r) => {
    setReminderForm({ id: r.id, subject: r.subject || "", date: r.date || toLocalDateKey(new Date()), notes: r.notes || "", job: jobKeyOf(r) });
  };

  const saveReminder = async () => {
    setReminderProblem("");
    const subject = reminderForm.subject.trim();
    if (!subject) return setReminderProblem("Enter a subject for this reminder.");

    // Saved on whatever day they picked, weekend included -- the calendar
    // grows a Saturday or Sunday column to show it.
    const date = toLocalDateKey(fromLocalDateKey(reminderForm.date));
    const notes = reminderForm.notes.trim() || null;
    const [jobKind, jobId] = (reminderForm.job || "").split(":");
    const job = {
      projectId: jobKind === "project" ? jobId : null,
      pipelineId: jobKind === "pipeline" ? jobId : null,
      partId: jobKind === "part" ? jobId : null
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
      setReminderProblem(`Couldn't save this reminder: ${err.message}`);
    } finally {
      setSavingReminder(false);
    }
  };

  const completeReminder = (r) => setAsk({
    title: "Mark this reminder complete?",
    message: `"${r.subject}" moves to Done. It stays on your calendar on the day it was due, and on the job it belongs to.`,
    confirmLabel: "Mark complete",
    onConfirm: () => reallyCompleteReminder(r)
  });

  const reallyCompleteReminder = async (r) => {
    setAsk(null);
    try {
      // Marked done, not deleted: the day it was due is history worth
      // keeping, and it stays on that day in the calendar.
      await updateDoc(doc(db, "reminders", r.id), completedPayload(uid));
      setReminders(prev => prev.map(x => (x.id === r.id ? { ...x, ...completedPayload(uid) } : x)));
      setReminderForm(null);
      showToast("Reminder completed");
    } catch (err) {
      showToast(`Couldn't complete this reminder: ${err.message}`, true);
    }
  };

  const followUpReminder = async (r) => {
    const next = fromLocalDateKey(r.date);
    next.setDate(next.getDate() + 7);
    const date = toLocalDateKey(skipWeekend(next));
    try {
      await updateDoc(doc(db, "reminders", r.id), { date });
      setReminders(prev => prev.map(x => (x.id === r.id ? { ...x, date } : x)));
      setReminderForm(null);
      showToast(`Reminder moved to ${date}`);
    } catch (err) {
      showToast(`Couldn't move this reminder: ${err.message}`, true);
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
  const rebuildDirectory = () => setAsk({
    title: "Rebuild the Directory?",
    message: "Every existing project and pipeline entry is walked again and anything missing is filed. Nothing is overwritten, but it can take a minute with a lot of data.",
    confirmLabel: "Rebuild",
    onConfirm: () => reallyRebuildDirectory()
  });

  const reallyRebuildDirectory = async () => {
    setAsk(null);
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
  // One alert, one path: notifyUsers writes it under the bell and asks the
  // server to email whoever wants that kind. The email body and the
  // opt-out both live with the alert type now, in lib/alertEmails, instead
  // of each call site carrying its own subject line and preference field.
  const notifyUser = (userId, { type, message, link }) =>
    notifyUsers([userId], { type, message, link });

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
      auth.currentUser?.getIdToken().then(idToken => fetch("/api/report-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ area: "Closed project update", message: `Failed to update "${label}" (customer ${c.id})`, detail: err.message })
      })).catch(() => {});
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
        return apply(c, { category: PRE_BID, closedOutcome: null, nextCheckIn: null },
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
      });
    }

    loadCustomers(uid, role === "admin");
  };

  const denyRequest = (customerId, request) => setAsk({
    title: "Deny this request?",
    message: `${request.requesterName} is told their request to collaborate was turned down.`,
    confirmLabel: "Deny",
    danger: true,
    onConfirm: () => reallyDenyRequest(customerId, request)
  });

  const reallyDenyRequest = async (customerId, request) => {
    setAsk(null);
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
    setNameProblem("");
    if (!nameFirst.trim() || !nameLast.trim()) {
      return setNameProblem("Enter both a first and a last name.");
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

  // Moving a check-in forward used to overwrite the old date and record
  // nothing, so "what was due last Tuesday" had no answer -- which is why
  // scrolling back through the calendar shows no check-in history before
  // today. Logging it means that history builds from here.
  // Whoever is signed in, by name. Written onto the entry at the time so
  // it still reads right after someone leaves the company.
  const myName = () =>
    myProfile && myProfile.firstName && myProfile.lastName
      ? `${myProfile.firstName} ${myProfile.lastName}`
      : (auth.currentUser?.email || null);

  const checkInMoved = (record, to, what) => ({
    // "handled", not "completed": the check-in was dealt with, the job
    // wasn't finished. The old label read as the whole job being done.
    type: "handled",
    outcome: what,
    notes: `Check-in ${String(record.nextCheckIn || "").slice(0, 10) || "(none)"} → ${String(to).slice(0, 10)}`,
    // The day the check-in was due. That is where it belongs on the
    // calendar -- moving it is admin, the due date is the history -- and
    // it's why snoozing something doesn't wipe it off the week it was on.
    onDate: String(record.nextCheckIn || "").slice(0, 10) || null,
    timestamp: new Date().toISOString(),
    by: uid,
    authorName: myName()
  });

  // An overdue check-in had nowhere to go from the panel: only reminders
  // carried buttons, so a late project or pipeline entry just sat there
  // being late. Push it out a week, or take it off the list entirely.
  const collectionOf = (c) => (c._kind === "pipeline" || c._kind === "bid" ? "pipeline" : "customers");

  const pushOutAWeek = async (c) => {
    const next = new Date();
    next.setDate(next.getDate() + 7);
    const to = adjustWeekend(next.toISOString());
    await updateDoc(doc(db, collectionOf(c), c.id), {
      nextCheckIn: to,
      activityLog: [...(c.activityLog || []), checkInMoved(c, to, "Pushed out a week")]
    });
    showToast("Pushed out to " + to);
    loadCustomers(uid, role === "admin");
    loadPipeline();
  };

  // Whatever a row is moved to, it moves to a real date rather than being
  // cleared. Clearing did take a job off the overdue list, but nothing
  // brought it back -- it sat on My Projects with an empty date until
  // somebody happened to notice.
  const moveCheckInTo = async (c, to) => {
    if (!to) return;
    await updateDoc(doc(db, collectionOf(c), c.id), {
      nextCheckIn: to,
      activityLog: [...(c.activityLog || []), checkInMoved(c, to, "Moved to a picked date")]
    });
    setPickingDateFor(null);
    setPickedDate("");
    showToast("Back on " + to);
    loadCustomers(uid, role === "admin");
    loadPipeline();
  };

  // A check-in done late is still done. Without this the only way off the
  // overdue list was to push the date, which records the admin and loses
  // the fact that somebody actually made the call.
  const markCheckedIn = async (c) => {
    const due = String(c.nextCheckIn || "").slice(0, 10);
    const today = toLocalDateKey(new Date());
    await updateDoc(doc(db, collectionOf(c), c.id), {
      lastContact: today,
      nextCheckIn: "",
      activityLog: [...(c.activityLog || []), {
        type: "handled",
        outcome: due && due !== today ? `Checked in ${today} (was due ${due})` : "Checked in",
        notes: null,
        onDate: due || today,
        timestamp: new Date().toISOString(),
        by: uid
      }]
    });
    showToast(due && due !== today ? `Checked in — was due ${due}` : "Checked in");
    loadCustomers(uid, role === "admin");
    loadPipeline();
  };

  // Follow Up used to assume two weeks without asking. Two weeks is right
  // often enough to keep as one press, but not so often it should be the
  // only option -- so it offers that and a date of your own.
  const [followUpFor, setFollowUpFor] = useState(null);
  // The pipeline entry whose reminders are open from a card. It renders
  // the entry page's own box, so there is one copy of the thing that
  // writes a reminder for everyone working the job.
  const [remindersFor, setRemindersFor] = useState(null);

  // The pipeline entry whose notes are open from a card. Projects have had
  // this since the start -- their grey box opens the thread -- and pipeline
  // entries never did, so the only way to leave a note on one was to open
  // the entry.
  const [notesFor, setNotesFor] = useState(null);
  const [pipelinePrivate, setPipelinePrivate] = useState({});

  const openPipelineNotes = async (p) => {
    setNotesFor(p);
    // Notes written before the thread existed live on the private doc, and
    // only the owner and an admin can read it -- the same rule the entry
    // page uses. Anyone else just gets the thread.
    if (!(p.ownerId === uid || role === "admin")) return;
    try {
      const snap = await getDoc(doc(db, "pipeline", p.id, "private", "data"));
      setPipelinePrivate(prev => ({ ...prev, [p.id]: snap.exists() ? snap.data() : {} }));
    } catch {
      // A private doc we can't read is not worth failing the popup over.
    }
  };

  // Moving a pipeline entry on from its card. Same shape as the project
  // one: the quiet steps are written here, and answering the bid opens the
  // entry, because there are two answers and each asks its own questions.
  const advancePipeline = (p) => {
    const to = nextPipelineStep(p.stage);
    if (!to) return;
    if (pipelineStepNeedsInput(p.stage)) {
      router.push(`/dashboard/pipeline/${p.id}`);
      return;
    }
    setStageMove({ kind: "pipeline", record: p, to, from: normalizeStage(p.stage) });
  };

  const doAdvancePipeline = async (p, to) => {
    const payload = { stage: to };
    if (movedToPostBid(p, payload)) payload.nextCheckIn = postBidCheckIn();
    await updateDoc(doc(db, "pipeline", p.id), {
      ...payload,
      activityLog: [...(p.activityLog || []), {
        type: "changed",
        outcome: `Stage: ${normalizeStage(p.stage)} → ${to}`,
        notes: null,
        timestamp: new Date().toISOString(),
        by: uid,
        authorName: myName()
      }]
    });
    showToast(`Moved to ${to}`);
    await loadPipeline();
  };

  const confirmStageMove = async () => {
    if (!stageMove) return;
    setMovingStage(true);
    try {
      if (stageMove.kind === "project") await doAdvanceProject(stageMove.record, stageMove.to);
      else await doAdvancePipeline(stageMove.record, stageMove.to);
      setStageMove(null);
    } finally {
      setMovingStage(false);
    }
  };

  // Moving a project on from its card. The quiet steps are written here;
  // anything that needs a form opens the project with ?advance=1, which
  // the project page reads and turns into the same popup its own button
  // raises. One copy of each question, wherever it was asked from.
  // Moving a stage is asked about first. The steps that open a form of
  // their own -- won or lost, and why it's closing -- do their own asking,
  // so they go straight there rather than putting a question in front of a
  // question.
  const [stageMove, setStageMove] = useState(null); // { kind, record, to }
  const [movingStage, setMovingStage] = useState(false);

  const advanceProject = (c) => {
    const to = nextStage(c.category);
    if (!to) return;
    if (stageNeedsInput(c.category)) {
      router.push(`/dashboard/project/${c.id}?advance=1`);
      return;
    }
    setStageMove({ kind: "project", record: c, to, from: normalizeCategory(c.category) });
  };

  const doAdvanceProject = async (c, to) => {
    await updateDoc(doc(db, "customers", c.id), {
      category: to,
      activityLog: [...(c.activityLog || []), {
        type: "changed",
        outcome: `Status: ${normalizeCategory(c.category)} → ${to}`,
        notes: null,
        timestamp: new Date().toISOString(),
        by: uid,
        authorName: myName()
      }]
    });
    showToast(`Moved to ${to}`);
    await loadCustomers(uid, role === "admin");
  };
  const [followUpDate, setFollowUpDate] = useState("");

  const openFollowUp = (c) => { setFollowUpDate(""); setFollowUpFor(c); };

  const followUpTo = async (c, to) => {
    if (!to) return;
    await updateDoc(doc(db, collectionOf(c), c.id), {
      nextCheckIn: to,
      activityLog: [...(c.activityLog || []), checkInMoved(c, to, "Pushed out")]
    });
    setFollowUpFor(null);
    setFollowUpDate("");
    showToast("Back on " + to);
    loadCustomers(uid, role === "admin");
    loadPipeline();
  };

  const followUpAWeek = (c) => {
    const next = new Date();
    next.setDate(next.getDate() + 7);
    followUpTo(c, adjustWeekend(next.toISOString()));
  };

  const stopShipAlerts = async (c) => {
    const id = c._recordId || c.id;
    await updateDoc(doc(db, collectionOf(c), id), { leadTimeAlerts: false });
    showToast("Ship-date alerts off for this job");
    loadCustomers(uid, role === "admin");
    loadPipeline();
  };

  const handleFollowUp = async (c) => {
    const next = new Date();
    next.setDate(next.getDate() + 14);
    const to = adjustWeekend(next.toISOString());

    await updateDoc(doc(db, "customers", c.id), {
      nextCheckIn: to,
      activityLog: [...(c.activityLog || []), checkInMoved(c, to, "Followed up")]
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
    const to = adjustWeekend(next.toISOString());

    await updateDoc(doc(db, "pipeline", p.id), {
      nextCheckIn: to,
      activityLog: [...(p.activityLog || []), checkInMoved(p, to, "Snoozed 3 months")]
    });

    showToast("Snoozed for 3 months");
    loadPipeline();
  };

  const pipelineFollowUpAnotherYear = async (p) => {
    const next = new Date();
    next.setFullYear(next.getFullYear() + 1);
    const to = adjustWeekend(next.toISOString());

    await updateDoc(doc(db, "pipeline", p.id), {
      nextCheckIn: to,
      activityLog: [...(p.activityLog || []), checkInMoved(p, to, "Followed up 1 year")]
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
    setOutcomeProblem("");
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
      return setOutcomeProblem("Choose the next due date.");
    }
    if (completedOutcome === "Lost" && !lostNotes.trim()) {
      return setOutcomeProblem("Say why the job was lost.");
    }
    if (completedOutcome === "Prospecting Only" && !prospectingNextDate) {
      return setOutcomeProblem("Choose the next alert date.");
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
    // would parse as UTC midnight and land a day early for anyone west of
    // UTC. Whatever day they chose is the day that's saved.
    const pickedDate = (key) => toLocalDateKey(fromLocalDateKey(key));

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
  };

  const closeModal = () => setSelected(null);

  const deleteHistoryEntry = (customerId, index) => setAsk({
    title: "Delete this note entry?",
    message: "It can't be brought back.",
    confirmLabel: "Delete",
    danger: true,
    onConfirm: () => reallyDeleteHistoryEntry(customerId, index)
  });

  const reallyDeleteHistoryEntry = async (customerId, index) => {
    setAsk(null);
    const existing = notesById[customerId] || { notesHistory: [] };
    const newHistory = (existing.notesHistory || []).filter((_, i) => i !== index);

    await setDoc(doc(db, "customers", customerId, "private", "data"), {
      ...existing,
      notesHistory: newHistory
    });

    setNotesById(prev => ({ ...prev, [customerId]: { ...existing, notesHistory: newHistory } }));
    showToast("Note entry deleted");
  };

  // Downloads of the page as it stands -- projects, pipeline entries and
  // reminders alike, filters included (lib/viewExport.js).
  const reminderJobName = (r) => {
    if (r.projectId) {
      const c = customers.find(x => x.id === r.projectId);
      return c ? `Project: ${c.projectName || c.company}` : "";
    }
    if (r.pipelineId) {
      const p = pipelineEntries.find(x => x.id === r.pipelineId);
      return p ? `Pipeline: ${p.title}` : "";
    }
    return "";
  };

  const showsType = (kind) => !personalType || personalType === kind;

  const PROJECT_SORTS = {
    due: { kind: "date", get: c => formatDate(c.nextCheckIn), label: "Due date" },
    name: { kind: "text", get: c => c.projectName || c.company, label: "Name" },
    firm: { kind: "text", get: c => c.company, label: "Contractor / owner" },
    value: { kind: "money", get: c => c.projectValue, label: "Value" },
    status: { kind: "text", get: c => c.category, label: "Stage" },
    created: { kind: "date", get: c => c.createdAt, label: "Date added" }
  };
  // Past Projects shows closed projects and resolved pipeline entries in
  // two lists. Same keys for both, so one picker orders them together.
  const PAST_SORTS = {
    closed: { kind: "date", get: c => closedDateOf(c), label: "Date closed" },
    name: { kind: "text", get: c => c.projectName || c.company, label: "Name" },
    firm: { kind: "text", get: c => c.company, label: "Firm" },
    value: { kind: "money", get: c => c.projectValue, label: "Value" },
    status: { kind: "text", get: c => c.closedOutcome || c.category, label: "Outcome" }
  };
  const PAST_PIPELINE_SORTS = {
    closed: { kind: "date", get: p => p.resolvedAt, label: "Date closed" },
    name: { kind: "text", get: p => p.title, label: "Name" },
    firm: { kind: "text", get: p => p.company, label: "Firm" },
    value: { kind: "money", get: p => p.value, label: "Value" },
    status: { kind: "text", get: p => p.outcome, label: "Outcome" }
  };

  const PIPELINE_SORTS = {
    bid: { kind: "date", get: p => p.bidDate, label: "Bid date" },
    name: { kind: "text", get: p => p.title, label: "Name" },
    firm: { kind: "text", get: p => p.company, label: "Engineering firm" },
    value: { kind: "money", get: p => p.value, label: "Value" },
    stage: { kind: "text", get: p => p.stage, label: "Stage" },
    created: { kind: "date", get: p => p.createdAt, label: "Date added" }
  };

  const exportMyProjects = (format) => exportDashboardView({
    page: "projects",
    projects: showsType("projects") ? filteredCustomers : [],
    pipelineEntries: showsType("pipeline") ? myPipelineEntries : [],
    reminders: showsType("reminders") ? activeReminders : [],
    users,
    viewer: { id: uid, ...(myProfile || {}) },
    format,
    filtered: anyActive(personalFilters),
    jobNameOf: reminderJobName
  });

  const exportTeamProjects = (format) => exportDashboardView({
    page: "team",
    projects: teamCustomers,
    users,
    viewer: { id: uid, ...(myProfile || {}) },
    format,
    filtered: anyActive(teamFilters)
  });

  const exportMyPipeline = (format) => exportDashboardView({
    page: "pipeline",
    pipelineEntries: filteredPipeline,
    // Estimating sees their reminders above the pipeline list; everyone
    // else's Pipeline tab has no reminder section to export.
    reminders: role === "estimating" && view === "personal" ? activeReminders : [],
    users,
    viewer: { id: uid, ...(myProfile || {}) },
    format,
    filtered: anyActive(pipelineFilters),
    jobNameOf: reminderJobName
  });

  const filteredCustomers = useMemo(() => {
    let list = customers.filter(c =>
      (c.ownerId === uid || (c.collaboratorIds || []).includes(uid) || hasShare(c, uid)) &&
      c.category !== "Project Closed"
    );

    const f = personalFilters;
    if (f.sector) list = list.filter(c => c.buildingSector === f.sector);
    if (f.workType) list = list.filter(c => c.workType === f.workType);
    if (f.firm) list = list.filter(c => c.company === f.firm || (c.owners || []).some(o => o.company === f.firm));
    if (f.status) list = list.filter(c => normalizeCategory(c.category) === normalizeCategory(f.status));
    list = list.filter(c => matchesDateFilter(c.nextCheckIn, f.due));

    return sortRows(list, PROJECT_SORTS, personalSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, uid, personalFilters, personalSort]);

  // Pipeline entries "on my dashboard" -- owner, assigned salesperson,
  // assigned project point person, or self-tracked. Pulled live from the
  // same pipelineEntries used by the Pipeline tab, so it's always a
  // mirror of the single underlying document, never a copy.
  const myPipelineEntries = useMemo(() => {
    return pipelineEntries
      .filter(p => isOnMyPipelineList(p, uid))
      .filter(p => !p.convertedToProjectId && !p.outcome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return sortRows(list, PAST_SORTS, pastSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, pastProjectsSearch, pastFilters, pastSort]);

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
    return sortRows(list, PAST_PIPELINE_SORTS, pastSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineEntries, pastProjectsSearch, pastFilters, pastSort]);

  const teamCustomers = useMemo(() => {
    let list = [...customers];

    const f = teamFilters;
    if (f.sector) list = list.filter(c => c.buildingSector === f.sector);
    if (f.workType) list = list.filter(c => c.workType === f.workType);
    if (f.person) list = list.filter(c => c.ownerId === f.person);
    if (f.firm) list = list.filter(c => c.company === f.firm || (c.owners || []).some(o => o.company === f.firm));
    if (f.status) list = list.filter(c => normalizeCategory(c.category) === normalizeCategory(f.status));
    if (f.outcome) list = list.filter(c => c.closedOutcome === f.outcome);
    list = list.filter(c => matchesDateFilter(c.nextCheckIn, f.due));

    return sortRows(list, PROJECT_SORTS, teamSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, teamFilters, teamSort]);

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

    return sortRows(list, PIPELINE_SORTS, pipelineSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineEntries, pipelineFilters, pipelineSort]);

  // HOME CALENDAR: four weeks from the Monday of this week, weekends
  // included only when something is due on one (see lib/calendarDays.js).
  // Which four weeks the calendar is showing. Starts on this week and
  // moves with the arrows or the date picker.
  const [calendarAnchor, setCalendarAnchor] = useState(() => new Date());
  const [showOverdue, setShowOverdue] = useState(false);
  // Which overdue row has its date picker open, by "kind-id", and what has
  // been picked but not yet confirmed.
  const [pickingDateFor, setPickingDateFor] = useState(null);
  const [pickedDate, setPickedDate] = useState("");
  const moveCalendar = (next) => { setCalendarAnchor(next); setSelectedCalendarDay(null); };
  const calendarWeeks = useMemo(() => buildCalendarWeeks(calendarAnchor, new Date()), [calendarAnchor]);



  // Reminders attached to a job that's been deleted (in the Trash) stay
  // hidden until the job is restored.
  const visibleReminders = useMemo(
    () => reminders.filter(r => reminderJobIsActive(r, customers, pipelineEntries, parts)),
    [reminders, customers, pipelineEntries, parts]
  );

  // Still to do -- what the panel, the overdue list and the digest chase.
  const activeReminders = useMemo(() => visibleReminders.filter(isOpen), [visibleReminders]);
  // Done, and kept: these sit on the calendar on the day they were due.
  const finishedReminders = useMemo(() => doneOnly(visibleReminders), [visibleReminders]);

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
      .filter(p => isPipelineBidAlertFor(p, uid, role, todayKey()))
      .map(p => ({ ...p, _kind: "bid", projectName: p.title, nextCheckIn: p.bidDate }));

    // An open entry's own next date (set when it went Post-Bid).
    const pipelineCheckIns = pipelineEntries
      .filter(p => isPipelineCheckInFor(p, uid, role))
      .map(p => ({ ...p, _kind: "pipeline", projectName: p.title }));

    const reminderItems = activeReminders.map(r => ({ ...r, _kind: "reminder", projectName: r.subject, nextCheckIn: r.date }));

    // What already happened, on the days it happened -- so a week behind
    // today shows what was on it rather than nothing. Read-only markers;
    // see lib/calendarHistory.js.
    // "Was this ever mine", not "should this chase me" -- the alert rules
    // all bail out once a job is settled, which would have hidden every
    // lost and did-not-bid entry from the history.
    const mineProject = (c) => wasMineOnProject(c, uid, role);
    const minePipeline = (p) => wasMineOnPipeline(p, uid, role);

    const history = dedupeByDay([
      ...resolvedBidItems(pipelineEntries, minePipeline),
      ...outcomeItems(pipelineEntries, customers, minePipeline, mineProject),
      ...activityItems(customers, mineProject, "outcome"),
      ...activityItems(pipelineEntries, minePipeline, "outcome"),
      // Ship dates only for records someone asked to be told about.
      ...leadTimeItems(customers, mineProject, r => leadTimeStatus(r, todayKey())),
      ...leadTimeItems(pipelineEntries, minePipeline, r => leadTimeStatus(r, todayKey())),
      // Reminders you finished, on the day they were due.
      ...doneReminderItems(finishedReminders)
    ]);

    // A Won entry's follow-up and an open entry's check-in are the same
    // field, so an entry never appears twice.
    const seen = new Set(pipelineFollowUps.map(p => p.id));
    return [
      ...projectItems,
      ...pipelineFollowUps,
      ...pipelineCheckIns.filter(p => !seen.has(p.id)),
      ...bidDates,
      ...reminderItems,
      ...history
    ];
  }, [customers, pipelineEntries, activeReminders, finishedReminders, uid, role]);

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
        sub: [normalizeStage(p.stage), p.bidDate && `Bid ${p.bidDate}`, p.company].filter(Boolean).join(" · ")
      }));
    // Parts requests are everyone's, so they're all offered.
    const partJobs = parts.map(p => ({
      key: `part:${p.id}`, kind: "part", id: p.id,
      label: p.item || "Parts request",
      sub: [p.company, p.stage, p.neededBy && `Needed ${p.neededBy}`].filter(Boolean).join(" · ")
    }));
    return [...projects, ...pipeline, ...partJobs].sort((a, b) => a.label.localeCompare(b.label));
  }, [customers, pipelineEntries, parts, role, uid]);

  const jobTitleOf = (r) => {
    if (r.projectId) {
      const c = customers.find(x => x.id === r.projectId);
      return c ? (c.projectName || c.company || "Untitled project") : "a project";
    }
    if (r.pipelineId) {
      const p = pipelineEntries.find(x => x.id === r.pipelineId);
      return p ? (p.title || "Untitled pipeline entry") : "a pipeline entry";
    }
    if (r.partId) {
      const x = parts.find(o => o.id === r.partId);
      return x ? (x.item || "Parts request") : "a parts request";
    }
    return "";
  };

  // Everything on the Home calendar opens a quick-view popup first; the
  // popup has the item's own actions plus a button to its full page.
  const openCalendarItem = (c) => setCalendarPopup(c);

  const calendarItemLink = (c) => {
    if (c._kind === "reminder") {
      if (c.projectId) return `/dashboard/project/${c.projectId}`;
      if (c.pipelineId) return `/dashboard/pipeline/${c.pipelineId}`;
      return c.partId ? `/dashboard/parts/${c.partId}` : null;
    }
    return c._kind === "pipeline" || c._kind === "bid" ? `/dashboard/pipeline/${c.id}` : `/dashboard/project/${c.id}`;
  };

  // Runs a popup action, then closes the popup.
  const fromPopup = (action) => async () => {
    const item = calendarPopup;
    setCalendarPopup(null);
    await action(item);
  };

  // Which calendar day an alert sits on (lib/calendarDays.js): its own
  // day, weekend included, with anything overdue pulled onto today.
  const calendarKeyFor = (c) => calendarDayKeyFor(formatDate(c.nextCheckIn));
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

  const weekendColumns = useMemo(
    () => weekendColumnsFor(calendarWeeks, key => (projectsByDay[key] || []).length > 0),
    [calendarWeeks, projectsByDay]
  );
  const calendarDays = useMemo(() => visibleCalendarDays(calendarWeeks, weekendColumns), [calendarWeeks, weekendColumns]);
  const calendarColumnLabels = useMemo(() => columnLabels(weekendColumns), [weekendColumns]);

  // The real current week, not the first row of whatever the calendar is
  // scrolled to. The panel answers "what's on now", so stepping back
  // through the calendar shouldn't empty it.
  const weekKeys = useMemo(() => {
    const start = startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return dateKey(d);
    });
  }, []);

  const panelProjects = useMemo(() => {
    if (selectedCalendarDay) {
      return [...(projectsByDay[selectedCalendarDay] || [])].sort(
        (a, b) => (a.projectName || a.company || "").localeCompare(b.projectName || b.company || "")
      );
    }
    // This week's work, plus anything still overdue however far back it
    // sits. Overdue items used to be dragged onto today's square so they
    // couldn't be missed; they stay on their real date now, so the panel
    // is what makes sure they're still seen.
    const weekSet = new Set(weekKeys);
    return myCalendarProjects
      .filter(c => !c._done)
      .filter(c => weekSet.has(calendarKeyFor(c)) || isOverdueItem(c))
      .sort((a, b) => getDateValue(a.nextCheckIn) - getDateValue(b.nextCheckIn));
  }, [selectedCalendarDay, projectsByDay, weekKeys, myCalendarProjects]);

  // Late work is folded away by default. It's usually the longer list and
  // it's rarely today's problem, so leaving it open pushed this week's
  // actual work off the bottom of the panel -- but it still has to be one
  // click from view, because nothing else surfaces it now that overdue
  // items sit on their own dates.
  const panelOverdue = useMemo(
    () => (selectedCalendarDay ? [] : panelProjects.filter(isOverdueItem)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedCalendarDay, panelProjects]
  );
  const panelCurrent = useMemo(
    () => (selectedCalendarDay ? panelProjects : panelProjects.filter(c => !isOverdueItem(c))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedCalendarDay, panelProjects]
  );

  const panelTitle = selectedCalendarDay
    ? new Date(selectedCalendarDay + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : "This Week";

  // ADMIN
  const resetNewUserForm = () => {
    setNewUserEmail("");
    setNewUserRole("member");
    setNewUserPermissions(defaultPermissionsFor("member"));
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
    setNewUserProblem("");
    const email = newUserEmail.trim();
    if (!email) return setNewUserProblem("Enter an email address.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setNewUserProblem("That doesn't look like an email address.");

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
        showToast(`The account for ${email} was created, but ${err.message}. Use "Send Reset Link" on their row in Team Members to email them a setup link.`, true);
      } else {
        setNewUserProblem(err.message || "Could not create account.");
      }
    } finally {
      setCreatingUser(false);
    }
  };

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
    { key: "status", label: "Stage", type: "select", options: optionsFrom(customers.map(c => c.category)) },
    { key: "outcome", label: "Outcome", type: "select", options: optionsFrom(customers.map(c => c.closedOutcome)) },
    { key: "due", label: "Next check-in", type: "date", presets: ["overdue", "today", "next7", "next30"] }
  ];

  const myActiveProjects = customers.filter(c =>
    (c.ownerId === uid || (c.collaboratorIds || []).includes(uid) || hasShare(c, uid)) && c.category !== "Project Closed"
  );
  const personalFilterDefs = [
    sectorFilter,
    workTypeFilter,
    { key: "firm", label: "Contractor / Owner", type: "select", options: optionsFrom(myActiveProjects.flatMap(c => [c.company, ...(c.owners || []).map(o => o.company)])) },
    { key: "status", label: "Stage", type: "select", options: optionsFrom(myActiveProjects.map(c => c.category)) },
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
    { key: "stage", label: "Stage", type: "select", options: optionsFrom(openPipeline.map(p => normalizeStage(p.stage))) },
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
              <span className="role-badge role-badge-admin" style={{ marginTop: 4 }}>Bid date · {normalizeStage(c.stage) || "Pipeline"}</span>
            ) : c._kind === "ship" ? (
              /* Without this a ship date rendered exactly like a check-in
                 on the same job -- two identical rows, one job, no way to
                 tell which was which. */
              <span className="role-badge" style={{ marginTop: 4 }}>
                {c._historyLabel || "Due to ship"}{c.leadTime ? ` · ${c.leadTime}` : ""}
              </span>
            ) : c._kind === "pipeline" ? (
              /* Two different things arrive as "pipeline": a won entry's
                 follow-up, and an open entry's own next date. Labelling
                 both as won was wrong on every Post-Bid entry -- and now
                 that the passed bid date no longer sits beside it, this
                 badge is the only thing saying what the row is. */
              <span className="role-badge role-badge-admin" style={{ marginTop: 4 }}>
                {c.outcome === "Won" ? <><Icon name="check" size={12} className="mark mark-won" /> Won — Check In</> : `${normalizeStage(c.stage) || "Pipeline"} — Check In`}
              </span>
            ) : c._kind === "reminder" ? (
              <>
                <span className="role-badge" style={{ marginTop: 4 }}><Icon name="bell" size={11} /> Reminder</span>
                {(c.projectId || c.pipelineId || c.partId) && <div className="customer-meta" style={{ marginTop: 4 }}>For {jobTitleOf(c)}</div>}
              </>
            ) : (
              c.category && <span className="role-badge" style={{ marginTop: 4 }}>{normalizeCategory(c.category)}</span>
            )}
            {c._kind === "reminder" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                <button className="btn btn-secondary" onClick={() => followUpReminder(c)}>Follow Up (1 Week)</button>
                <button className="btn btn-primary" onClick={() => completeReminder(c)}>Complete</button>
              </div>
            )}

            {/* Late, and something can be done about it from here. A week
                covers "not yet, but soon"; picking the day covers the rest.
                Both work by moving the next date forward, which is what
                takes the row off the overdue list. */}
            {isOverdueItem(c) && (c._kind === "project" || c._kind === "pipeline") && !c._done && (
              <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                <div className="overdue-actions">
                  <button className="btn btn-primary btn-small" onClick={() => markCheckedIn(c)}>Complete</button>
                  <button className="btn btn-secondary btn-small" onClick={() => pushOutAWeek(c)}>Push Out A Week</button>
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={() => {
                      setPickedDate("");
                      setPickingDateFor(prev => (prev === `${c._kind}-${c.id}` ? null : `${c._kind}-${c.id}`));
                    }}
                  >
                    Pick a date
                  </button>
                </div>
                {/* Choosing and confirming are two steps on purpose. A
                    native date field fires a change for every part of the
                    date as it's built -- paging to the next month counts --
                    so saving on change moved the job to whatever the picker
                    happened to be showing at the time. */}
                {pickingDateFor === `${c._kind}-${c.id}` && (
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      className="field"
                      type="date"
                      style={{ marginBottom: 0, width: "auto" }}
                      aria-label={`New date for ${c.projectName || c.company}`}
                      min={toLocalDateKey(new Date())}
                      value={pickedDate}
                      onChange={e => setPickedDate(e.target.value)}
                    />
                    <button
                      className="btn btn-primary btn-small"
                      disabled={!pickedDate}
                      onClick={() => moveCheckInTo(c, pickedDate)}
                    >
                      {pickedDate ? `Push to ${pickedDate}` : "Pick a date first"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* A ship date isn't a date anyone picked -- it's worked out
                from the lead time and the order date, so there's nothing
                to push. Turning the alert off is what "take it off my
                list" means here. */}
            {isOverdueItem(c) && c._kind === "ship" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                <button className="btn btn-secondary" onClick={() => stopShipAlerts(c)}>Stop alerting me</button>
              </div>
            )}

            {/* A bid date that has passed is answered, not rescheduled --
                the two buttons for that live on the entry itself. */}
            {isOverdueItem(c) && c._kind === "bid" && !c._done && (() => {
              // Say whose answer this is. The bid-date alert goes to
              // everyone on the entry, so without a name it reads as
              // somebody else's problem to all of them.
              const assigned = [c.salespersonId, c.projectPointPersonId]
                .filter(Boolean)
                .filter((v, i, a) => a.indexOf(v) === i);
              // Unassigned falls to whoever entered it, same as the alert.
              const toAnswer = assigned.length ? assigned : [c.ownerId].filter(Boolean);
              const mine = toAnswer.includes(uid);
              return (
                <div onClick={e => e.stopPropagation()}>
                  <div className="private-note-hint" style={{ marginTop: 6 }}>
                    {toAnswer.length
                      ? `${toAnswer.map(id => ownerLabel(id)).join(" and ")} to say whether we bid it.`
                      : "Nobody is on this entry at all."}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      className={mine ? "btn btn-primary" : "btn btn-secondary"}
                      onClick={() => router.push(`/dashboard/pipeline/${c.id}`)}
                    >
                      Bids sent or not bidding?
                    </button>
                  </div>
                </div>
              );
            })()}
            {c._kind === "project" && isClosedWithCheckIn(c) && c.ownerId === uid && (
              <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                <ClosedCheckInActions
                  project={c}
                  byName={myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : auth.currentUser?.email}
                  onDone={(msg) => { showToast(msg); loadCustomers(uid, role === "admin"); }}
                />
              </div>
            )}
            {c._kind === "pipeline" && c.outcome === "Won" && (
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
          <span className="role-badge" style={{ marginTop: 6 }}><Icon name="bell" size={11} /> Reminder</span>
          {(r.projectId || r.pipelineId) && <div className="customer-meta" style={{ marginTop: 4 }}>For {jobTitleOf(r)}</div>}
          <div className="customer-dates">Due: {r.date}</div>
        </div>
        <div className="customer-card-middle customer-notes-preview">
          {r.notes ? <div style={{ whiteSpace: "pre-wrap" }}>{r.notes}</div> : <div className="private-note-hint">No notes</div>}
        </div>
        <div className="customer-card-right" onClick={e => e.stopPropagation()}>
          {/* The same block the project and pipeline cards use: the two
              that put it off or change it side by side, and the one that
              finishes it on its own line underneath. */}
          <div className="card-actions-stack">
            <div className="card-actions-row">
              <button className="btn btn-secondary" onClick={() => followUpReminder(r)}>Follow Up (1 Week)</button>
              <button className="btn btn-secondary" onClick={() => openEditReminder(r)}>Edit</button>
            </div>
            <button className="btn btn-primary" onClick={() => completeReminder(r)}>Complete</button>
          </div>
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

          {nameProblem && <p className="settings-status is-error">⚠ {nameProblem}</p>}
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
              onClick={() => openView(view === "admin" ? "personal" : "admin")}
            >
              {view === "admin" ? "Back to My Projects" : "Admin Settings"}
            </button>
          )}

          <div className="alerts-menu">
            {/* Opens on hover with a mouse, on tap on touch screens (TouchMenus). */}
            <button className="avatar-circle" style={{ position: "relative" }} aria-label="Alerts">
              <Icon name="bell" size={15} />
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
                    <p className="private-note-hint" style={{ color: "var(--color-danger)" }}>⚠ Couldn't load alerts: {notificationsError}</p>
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
                {/* Same order as the shared header's menu in
                    DashboardHeader.js -- this page has its own copy of
                    this dropdown, so the two have to be changed together. */}
                {canViewAnalytics(myProfile) && (
                  <button className="btn btn-secondary btn-block" onClick={() => router.push("/dashboard/analytics")}>
                    Analytics
                  </button>
                )}
                <button
                  className="btn btn-secondary btn-block"
                  style={canViewAnalytics(myProfile) ? { marginTop: 8 } : undefined}
                  onClick={() => setExportFor({ self: true })}
                >
                  Export My Data
                </button>
                <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={() => setShowUserSettings(true)}>
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
        <ViewTabs
          profile={myProfile}
          role={role}
          view={view}
          onSelectView={openView}
          onAddReminder={openNewReminder}
          searchData={{ customers, pipelineEntries, companies, contacts, parts }}
        />
      )}

      {view === "home" && (
        <div className="home-layout">
          <div className="calendar-container">
            <CalendarNav anchor={calendarAnchor} onAnchor={moveCalendar} idPrefix="home-cal" />
            <div
              className="calendar-weekday-header"
              style={{ gridTemplateColumns: `repeat(${calendarColumnLabels.length}, 1fr)` }}
            >
              {calendarColumnLabels.map(d => (
                <div key={d} className="calendar-weekday">{d}</div>
              ))}
            </div>

            <div
              className="calendar-grid"
              style={{ gridTemplateColumns: `repeat(${calendarColumnLabels.length}, 1fr)` }}
            >
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
                          className={`calendar-event-pill ${c._kind === "reminder" ? "calendar-event-pill-reminder" : ""} ${c._done ? "calendar-event-pill-done" : isOverdueItem(c) ? "calendar-event-pill-overdue" : ""}`}
                          title={c._historyLabel || undefined}
                          onClick={(e) => { e.stopPropagation(); openCalendarItem(c); }}
                        >
                          {c._done ? "✓ " : ""}{c.projectName || c.company}
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

          <div className="calendar-side-column">
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
              <p className="private-note-hint" style={{ color: "var(--color-danger)" }}>⚠ Couldn't load your reminders: {remindersError}</p>
            )}

            {panelProjects.length === 0 && (
              <p className="private-note-hint">Nothing due.</p>
            )}

            {panelOverdue.length > 0 && (
              <div className="overdue-fold">
                <button
                  type="button"
                  className="overdue-fold-toggle"
                  aria-expanded={showOverdue}
                  onClick={() => setShowOverdue(v => !v)}
                >
                  <span className="overdue-fold-caret" aria-hidden="true">{showOverdue ? "▾" : "▸"}</span>
                  {panelOverdue.length} overdue {panelOverdue.length === 1 ? "item" : "items"}
                </button>
                {showOverdue && <div className="overdue-fold-list">{panelOverdue.map(renderCalendarItem)}</div>}
              </div>
            )}

            {panelCurrent.map(renderCalendarItem)}

            {panelCurrent.length === 0 && panelOverdue.length > 0 && !showOverdue && (
              <p className="private-note-hint">Nothing else due this week.</p>
            )}
          </div>

          {/* Your own numbers, under what's due. They used to sit on top
              of My Projects, which pushed the actual list of work down the
              page; Home is where you glance at how things stand. */}
          <MyScorecard pipelineEntries={pipelineEntries} projects={customers} uid={uid} />
          </div>
        </div>
      )}

      {view === "personal" && role !== "estimating" && (
        <>
          <div className="list-toolbar">
            <button
              className={`btn btn-secondary ${anyActive(personalFilters) ? "has-filters" : ""}`}
              onClick={() => setOpenFilters(prev => ({ ...prev, personal: !prev.personal }))}
            >
              Filters{anyActive(personalFilters) ? ` (${Object.values(personalFilters).filter(isFilterActive).length})` : ""}
            </button>
            <SortPicker id="personal-sort" options={PROJECT_SORTS} sort={personalSort} onChange={setPersonalSort} />
            <select
              className="field"
              aria-label="Show"
              style={{ maxWidth: 190, marginBottom: 0 }}
              value={personalType}
              onChange={e => setPersonalType(e.target.value)}
            >
              <option value="">Everything</option>
              <option value="projects">Projects only</option>
              <option value="pipeline">Pipeline only</option>
              <option value="reminders">Reminders only</option>
            </select>
            <ExportButtons label="this page" buttonText="Export page" onExport={exportMyProjects} disabled={!filteredCustomers.length && !myPipelineEntries.length && !activeReminders.length} />
            <button className="btn btn-primary list-toolbar-add" onClick={() => router.push("/dashboard/project/new")}>Add Project</button>
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
          {sortMixed([
            ...(showsType("projects") ? filteredCustomers : []).map(c => {
            const days = diffDays(c.nextCheckIn);
            const isOwner = c.ownerId === uid;
            const pendingRequests = requestsById[c.id] || [];

            let barClass = "badge-bar-ok";
            if (days <= 0) barClass = "badge-bar-overdue";
            else if (days <= 2) barClass = "badge-bar-soon";

            return { sortFields: { date: formatDate(c.nextCheckIn), name: c.projectName || c.company, firm: c.company, value: c.projectValue, status: c.category, created: c.createdAt }, element: (
              <div
                key={c.id}
                className={`customer-card ${barClass}`}
                onClick={() => router.push(`/dashboard/project/${c.id}`)}
                style={{ cursor: "pointer" }}
              >

                {/* LEFT */}
                <div className="customer-card-left">
                  {!isOwner && <div className="owner-badge" style={{ marginBottom: 6 }}>Collaborating with {ownerLabel(c.ownerId)}</div>}
                      <div className="customer-name-row">
                        <div className="customer-name">{c.projectName || c.company}</div>
                        {c.category && <span className="role-badge">{normalizeCategory(c.category)}</span>}
                      </div>
                      {c.company && (c.projectName && c.projectName !== c.company) && (
                        <div className="customer-contact">{c.company}</div>
                      )}

                      <div className="customer-contact">
                        {c.contact}
                      </div>

                      {(c.email || c.phone) && (
                        <div className="customer-meta">
                          {[c.email, formatPhone(c.phone)].filter(Boolean).join(" | ")}
                        </div>
                      )}

                  {c.buildingSector && <div className="customer-meta" style={{ marginTop: 4 }}>Sector: {c.buildingSector}</div>}
                      {c.projectValue && <div className="customer-meta" style={{ marginTop: 4 }}>Value: {withDollar(c.projectValue)}</div>}
                  {c.workType && <div className="customer-meta" style={{ marginTop: 4 }}>{c.workType}</div>}
                  {/* A project usually has several components coming, on
                      several different lead times. The one kept on the
                      record is the longest of them, since they ship
                      together -- so the card says which one it is. */}
                  {c.leadTime && (
                    <div className="customer-meta" style={{ marginTop: 4 }}>
                      Lead time (longest component): {c.leadTime}
                      <LeadTimeSummary record={c} subject="This job&rsquo;s components" className="customer-meta" />
                    </div>
                  )}

                      <div className="customer-dates">Next: {formatDate(c.nextCheckIn)}</div>
                      {c.lastContact && <div className="customer-dates">Last: {formatDate(c.lastContact)}</div>}
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
                          <span>{r.requesterName} wants to collaborate</span>
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
                          <span>Collaborating with {ownerLabel(collabId)}</span>
                          <button className="btn btn-danger" onClick={() => revokeCollaborator(c.id, collabId)}>Revoke</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* RIGHT */}
                <div className="customer-card-right" onClick={(e) => e.stopPropagation()}>
                  {isOwner ? (
                    <div className="card-actions-stack">
                      <div className="card-actions-row">
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => { e.stopPropagation(); openFollowUp(c); }}
                        >
                          Follow Up
                        </button>

                        <button
                          className="btn btn-secondary"
                          onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/project/${c.id}?edit=1`); }}
                        >
                          Edit
                        </button>
                      </div>

                      {/* One step along, without opening the job. The steps
                          that ask a question first -- won or lost, and why
                          it's closing -- open the project and raise it
                          there, so those forms live in one place. */}
                      {nextStage(c.category) && (
                        <button
                          className="btn btn-primary"
                          onClick={(e) => { e.stopPropagation(); advanceProject(c); }}
                        >
                          {nextStageLabel(c.category)}
                        </button>
                      )}
                    </div>
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
                sortFields: { date: formatDate(c.nextCheckIn), name: c.projectName || c.company, firm: c.company, value: c.projectValue, status: c.category, created: c.createdAt },
                element: (
                  <div
                    key={`closed-checkin-${c.id}`}
                    className="customer-card badge-bar-overdue"
                    onClick={() => router.push(`/dashboard/project/${c.id}`)}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="customer-card-left">
                      <div className="customer-name-row">
                        <div className="customer-name">{c.projectName || c.company}</div>
                        <span className="role-badge">Closed project check-in</span>
                      </div>
                      {c.company && c.projectName && c.projectName !== c.company && <div className="customer-contact">{c.company}</div>}
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
            ...(showsType("reminders") ? activeReminders : [])
              .map(r => ({ sortFields: { date: r.date, name: r.subject, firm: "", value: "", status: "", created: r.createdAt }, element: renderReminderCard(r) })),
            ...(showsType("pipeline") ? myPipelineEntries : []).map(p => ({
              sortFields: { date: p.bidDate, name: p.title, firm: p.company, value: p.value, status: normalizeStage(p.stage), created: p.createdAt },
              element: (
                <div
                  key={`pipeline-${p.id}`}
                  className="customer-card"
                  onClick={() => router.push(`/dashboard/pipeline/${p.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <div className="customer-card-left">
                    <div className="customer-name-row">
                      <div className="customer-name">{p.title}</div>
                      <span className="role-badge role-badge-admin">Pipeline · {normalizeStage(p.stage)}</span>
                    </div>
                    {p.buildingSector && <div className="customer-meta" style={{ marginTop: 4 }}>Sector: {p.buildingSector}</div>}
                    {p.value && <div className="customer-meta" style={{ marginTop: 4 }}>Value: {withDollar(p.value)}</div>}
                    {p.workType && <div className="customer-meta" style={{ marginTop: 4 }}>{p.workType}</div>}
                  </div>
                  <div
                    className="customer-card-middle customer-notes-preview"
                    onClick={(e) => { e.stopPropagation(); openPipelineNotes(p); }}
                  >
                    {p.company && <div className="private-note-hint">{p.company}</div>}
                    {p.bidDate && <div className="customer-dates">Bid: {p.bidDate}</div>}
                    <div className="private-note-hint">Notes</div>
                  </div>

                  <div className="customer-card-right" onClick={(e) => e.stopPropagation()}>
                    <div className="card-actions-stack">
                      <div className="card-actions-row">
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => { e.stopPropagation(); setRemindersFor(p); }}
                        >
                          Set Reminder
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/pipeline/${p.id}?edit=1`); }}
                        >
                          Edit
                        </button>
                      </div>
                      {nextPipelineStep(p.stage) && (
                        <button
                          className="btn btn-primary"
                          onClick={(e) => { e.stopPropagation(); advancePipeline(p); }}
                        >
                          {nextPipelineStepLabel(p.stage)}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            }))
          ], personalSort).map(item => item.element)}

          {remindersError && (
            <p className="private-note-hint" style={{ color: "var(--color-danger)" }}>⚠ Couldn't load your reminders: {remindersError}</p>
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
                {/* The same thread the project's own page shows, so a note
                    written here isn't a second, separate kind of note. */}
                {uid && (
                  <RecordNotes
                    record={selected}
                    users={users}
                    recordTitle={selected.projectName || selected.company}
                    recordLink={`/dashboard/project/${selected.id}`}
                    collectionName="customers"
                    recordId={selected.id}
                    uid={uid}
                    myName={myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : (auth.currentUser?.email || "Unknown")}
                    canAdd
                    legacyNotes={notesById[selected.id]?.notes}
                    legacyHistory={notesById[selected.id]?.notesHistory}
                    onDeleteLegacy={(i) => deleteHistoryEntry(selected.id, i)}
                  />
                )}
              </div>
            </div>
          )}

        </>
      )}

      {view === "team" && (
        <>
          <div className="list-toolbar">
            <SortPicker id="team-sort" options={PROJECT_SORTS} sort={teamSort} onChange={setTeamSort} />
            <span className="list-toolbar-add">
              <ExportButtons
                label="this page"
                buttonText="Export page"
                onExport={exportTeamProjects}
                disabled={!teamCustomers.length}
              />
            </span>
          </div>

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
                onClick={() => router.push(`/dashboard/project/${c.id}?from=team`)}
                className={`customer-card ${barClass}`}
                style={{ cursor: "pointer" }}
              >
                <div className="customer-card-left">
                  <div className="customer-name-row">
                    <div className="customer-name">{c.projectName || c.company}</div>
                    {c.category && <span className="role-badge">{normalizeCategory(c.category)}</span>}
                  </div>
                  {c.company && (c.projectName && c.projectName !== c.company) && (
                    <div className="customer-contact">{c.company}</div>
                  )}
                  <div className="customer-contact">{c.contact}</div>
                  {(c.email || c.phone) && (
                    <div className="customer-meta">
                      {[c.email, formatPhone(c.phone)].filter(Boolean).join(" | ")}
                    </div>
                  )}
                  {c.buildingSector && <div className="customer-meta" style={{ marginTop: 4 }}>Sector: {c.buildingSector}</div>}
                  {c.projectValue && <div className="customer-meta" style={{ marginTop: 4 }}>Value: {withDollar(c.projectValue)}</div>}
                  {c.workType && <div className="customer-meta" style={{ marginTop: 4 }}>{c.workType}</div>}
                  <div className="customer-dates">Next: {formatDate(c.nextCheckIn)}</div>
                  {c.lastContact && <div className="customer-dates">Last: {formatDate(c.lastContact)}</div>}
                </div>

                <div className="customer-card-middle">
                  <div className="owner-badge">Owned by {ownerLabel(c.ownerId)}</div>
                  {isCollaborator ? (
                    <div className="private-note-hint">You&apos;re collaborating on this entry</div>
                  ) : role === "admin" ? (
                    <div className="private-note-hint">Notes visible to you as admin</div>
                  ) : (
                    <div className="private-note-hint"><Icon name="lock" size={11} /> Notes are private to {ownerLabel(c.ownerId)}</div>
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
          {view === "personal" && (
            <div style={{ marginBottom: 24 }}>
              <h3 className="modal-title" style={{ marginBottom: 12 }}>My Reminders</h3>
              {remindersError && (
                <p className="private-note-hint" style={{ color: "var(--color-danger)" }}>⚠ Couldn't load your reminders: {remindersError}</p>
              )}
              {!remindersError && activeReminders.length === 0 && (
                <p className="private-note-hint">No reminders. Use Reminders → Add reminder to create one.</p>
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
            <SortPicker id="pipeline-sort" options={PIPELINE_SORTS} sort={pipelineSort} onChange={setPipelineSort} />
            <ExportButtons label="this page" buttonText="Export page" onExport={exportMyPipeline} disabled={!filteredPipeline.length} />
            {/* Estimating's own page is the pipeline list, so someone who
                files work for the sales team needs the project form here
                too -- it's the only place they'd look for it. */}
            <span className="list-toolbar-add" style={{ display: "flex", gap: 10 }}>
              {view === "personal" && role === "estimating" && canEnterForOthers({ ...(myProfile || {}), role }) && (
                <button className="btn btn-secondary" onClick={() => router.push("/dashboard/project/new")}>
                  Add Project
                </button>
              )}
              <button className="btn btn-primary" onClick={() => router.push("/dashboard/pipeline/new")}>
                Add Pipeline Entry
              </button>
            </span>
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

          {groupByBid(filteredPipeline).map(group => (
            <div key={group.key} className="pipeline-group">
              <div className="pipeline-group-head">
                <h3 className="pipeline-group-title">{group.title}</h3>
                <span className="pipeline-group-blurb">{group.blurb}</span>
                <span className="pipeline-group-count">{group.entries.length}</span>
              </div>
              {group.entries.map(p => (
            <div
              key={p.id}
              className="customer-card"
              onClick={() => router.push(`/dashboard/pipeline/${p.id}`)}
              style={{ cursor: "pointer" }}
            >
              <div className="customer-card-left">
                <div className="customer-name-row">
                  <div className="customer-name">{p.title}</div>
                  <span className="role-badge role-badge-admin">{normalizeStage(p.stage)}</span>
                </div>
                {p.company && <div className="customer-contact">{p.company}</div>}
                {p.contact && <div className="customer-meta">{p.contact}</div>}
                {p.buildingSector && <div className="customer-meta" style={{ marginTop: 4 }}>Sector: {p.buildingSector}</div>}
                {p.value && <div className="customer-meta" style={{ marginTop: 4 }}>Value: {withDollar(p.value)}</div>}
                {p.workType && <div className="customer-meta" style={{ marginTop: 4 }}>{p.workType}</div>}
              </div>

              <div
                className="customer-card-middle customer-notes-preview"
                onClick={(e) => { e.stopPropagation(); openPipelineNotes(p); }}
              >
                <div className="owner-badge">Owned by {ownerLabel(p.ownerId)}</div>
                {p.bidDate && <div className="customer-dates">Bid Date: {p.bidDate}</div>}
                {(p.biddingCompanies || []).length > 0 && (
                  <div className="private-note-hint">
                    {p.biddingCompanies.length} contractor{p.biddingCompanies.length === 1 ? "" : "s"} bidding
                  </div>
                )}
                {p.convertedToProjectId && (
                  <div className="private-note-hint" style={{ marginTop: 4 }}><Icon name="check" size={12} className="mark mark-won" /> Converted to project</div>
                )}
              </div>

              <div className="customer-card-right" onClick={(e) => e.stopPropagation()}>
                {/* A pipeline entry is the team's, not one person's: the
                    entry page lets anyone signed in edit it and the rules
                    agree, so "View only" on this card was never true. */}
                {uid ? (
                  <div className="card-actions-stack">
                    <div className="card-actions-row">
                      <button
                        className="btn btn-secondary"
                        onClick={(e) => { e.stopPropagation(); setRemindersFor(p); }}
                      >
                        Set Reminder
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/pipeline/${p.id}?edit=1`); }}
                      >
                        Edit
                      </button>
                    </div>
                    {nextPipelineStep(p.stage) && (
                      <button
                        className="btn btn-primary"
                        onClick={(e) => { e.stopPropagation(); advancePipeline(p); }}
                      >
                        {nextPipelineStepLabel(p.stage)}
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="private-note-hint">View only</span>
                )}
              </div>
            </div>
              ))}
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
            <SortPicker id="past-sort" options={PAST_SORTS} sort={pastSort} onChange={setPastSort} />
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
              onClick={() => router.push(`/dashboard/project/${c.id}?from=pastProjects`)}
              style={{ cursor: "pointer" }}
            >
              <div className="customer-card-left">
                <div className="customer-name-row">
                  <div className="customer-name">{c.projectName || c.company}</div>
                  <span className="role-badge">
                    {/* A closed project with a future alert on file (Won awaiting
                        start, or Prospecting Only awaiting its next check-in)
                        isn't done for good -- it's just parked until then. */}
                    {c.closedOutcome === "Prospecting Only" && c.nextCheckIn ? "Temporarily Closed" : normalizeCategory(c.category)}
                  </span>
                </div>
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
                <div className="customer-name-row">
                  <div className="customer-name">{p.title}</div>
                  <span className={`role-badge ${p.outcome === "Won" ? "role-badge-admin" : ""}`}>
                    {p.outcome === "Won"
                      ? <><Icon name="check" size={12} className="mark mark-won" /> Won</>
                      : p.outcome === "Did Not Bid"
                        ? <><Icon name="ban" size={12} className="mark mark-dnb" /> DID NOT BID</>
                        : <><Icon name="cross" size={12} className="mark mark-lost" /> Lost</>}
                  </span>
                </div>
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
            <select
              id="new-user-role"
              className="field"
              value={newUserRole}
              onChange={e => {
                setNewUserRole(e.target.value);
                // Start from what's usual for the role; every box stays
                // editable from here.
                setNewUserPermissions(defaultPermissionsFor(e.target.value));
              }}
            >
              <option value="member">Salesperson</option>
              <option value="estimating">Estimating Department</option>
              <option value="admin">Admin</option>
            </select>

            <label className="field-label" style={{ marginTop: 8 }}>Permissions</label>
            {PERMISSION_DEFS.map(p => {
              const typical = (p.defaultForRoles || []).includes(newUserRole);
              return (
                <label key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!!newUserPermissions[p.key]}
                    onChange={() => setNewUserPermissions(prev => ({ ...prev, [p.key]: !prev[p.key] }))}
                  />
                  {p.label}
                  {typical && <span className="private-note-hint" style={{ margin: 0 }}>(usual for this role)</span>}
                </label>
              );
            })}

            {newUserProblem && <p className="settings-status is-error">⚠ {newUserProblem}</p>}
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

            {outcomeProblem && <p className="settings-status is-error">⚠ {outcomeProblem}</p>}
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
          : c._kind === "pipeline" ? (c.outcome === "Won" ? "Won — check in" : `${c.stage || "Pipeline"} — check in`)
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
                    <button className="btn btn-secondary" onClick={fromPopup(followUpReminder)}>Follow Up (1 Week)</button>
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
                    byName={myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : auth.currentUser?.email}
                    onDone={(msg) => { setCalendarPopup(null); showToast(msg); loadCustomers(uid, role === "admin"); }}
                  />
                )}
                {c._kind === "pipeline" && c.outcome === "Won" && (
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

            {reminderProblem && <p className="settings-status is-error">⚠ {reminderProblem}</p>}
            <div className="modal-actions">
              <button className="btn btn-primary" disabled={savingReminder} onClick={saveReminder}>
                {savingReminder ? "Saving..." : reminderForm.id ? "Save Changes" : "Add Reminder"}
              </button>
              {reminderForm.id && (
                <>
                  <button className="btn btn-secondary" onClick={() => followUpReminder(reminders.find(r => r.id === reminderForm.id))}>Follow Up (1 Week)</button>
                  <button className="btn btn-secondary" onClick={() => completeReminder(reminders.find(r => r.id === reminderForm.id))}>Complete</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The entry page's own reminder box, opened from a card. Rendering
          the component itself rather than a copy of it means "remind
          everyone on this entry" still reaches the owner, the salesperson,
          the point person and every bidding contractor's salesperson --
          one list, one place. */}
      {notesFor && (
        <div className="modal-overlay" onClick={() => setNotesFor(null)}>
          <div className="modal-card modal-wide" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setNotesFor(null)} aria-label="Close">✕</button>
            <h3 className="modal-title">{notesFor.title}</h3>
            <p className="modal-subtitle">Notes on this pipeline entry.</p>
            {uid && (
              <PipelineNotes
                pipeline={notesFor}
                users={users}
                pipelineId={notesFor.id}
                uid={uid}
                myName={myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : (auth.currentUser?.email || "Unknown")}
                legacyNotes={pipelinePrivate[notesFor.id]?.notes}
                legacyHistory={pipelinePrivate[notesFor.id]?.notesHistory}
                span=""
              />
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setNotesFor(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {stageMove && (
        <ConfirmDialog
          title={`Move to ${stageMove.to}?`}
          confirmLabel="Move it"
          busy={movingStage}
          onCancel={() => setStageMove(null)}
          onConfirm={confirmStageMove}
        >
          <p>
            <strong>{stageMove.record.projectName || stageMove.record.title || stageMove.record.company}</strong>{" "}
            moves from {stageMove.from || "no stage"} to {stageMove.to}.
          </p>
          <p className="private-note-hint">
            It&apos;s written into the {stageMove.kind === "pipeline" ? "entry" : "job"}&apos;s history,
            and you can move it back.
          </p>
        </ConfirmDialog>
      )}

      {remindersFor && (
        <div className="modal-overlay" onClick={() => setRemindersFor(null)}>
          <div className="modal-card modal-wide" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setRemindersFor(null)} aria-label="Close">✕</button>
            <h3 className="modal-title">Set a reminder</h3>
            <p className="modal-subtitle">{remindersFor.title}</p>
            <PipelineMyAlerts pipeline={remindersFor} uid={uid} users={users} />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setRemindersFor(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {followUpFor && (
        <div className="modal-overlay" onClick={() => setFollowUpFor(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <button className="modal-close" onClick={() => setFollowUpFor(null)} aria-label="Close">✕</button>
            <h3 className="modal-title">Follow up on this</h3>
            <p className="modal-subtitle">
              {followUpFor.projectName || followUpFor.company} — due {String(formatDate(followUpFor.nextCheckIn) || "").slice(0, 10) || "no date yet"}.
            </p>

            <button className="btn btn-primary btn-block" onClick={() => followUpAWeek(followUpFor)}>
              Push Out A Week
            </button>

            <label className="field-label" style={{ marginTop: 14 }} htmlFor="follow-up-date">Or pick your own date</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                id="follow-up-date"
                className="field"
                type="date"
                style={{ marginBottom: 0, width: "auto" }}
                min={toLocalDateKey(new Date())}
                value={followUpDate}
                onChange={e => setFollowUpDate(e.target.value)}
              />
              <button
                className="btn btn-secondary"
                disabled={!followUpDate}
                onClick={() => followUpTo(followUpFor, followUpDate)}
              >
                {followUpDate ? `Push to ${followUpDate}` : "Pick a date first"}
              </button>
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

      {toast && <div className={`toast ${toastBad ? "is-error" : ""}`}>{toast}</div>}
    </div>
  );
}
