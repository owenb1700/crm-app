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

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const CATEGORY_OPTIONS = ["Pre-Bid", "Prospecting", "Ongoing Project", "Order", "Parts"];

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

export default function Dashboard() {
  const router = useRouter();

  // AUTH / PROFILE
  const [uid, setUid] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [role, setRole] = useState(null); // 'admin' | 'member' | null (loading)
  const [view, setView] = useState("personal"); // 'personal' | 'team' | 'admin'

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

  // COLLABORATION
  const [requestsById, setRequestsById] = useState({}); // customerId -> pending requests on entries I own
  const [requestedIds, setRequestedIds] = useState(new Set()); // customerIds I've just requested (optimistic)
  const [teamFilterOwner, setTeamFilterOwner] = useState("all");
  const [teamNotes, setTeamNotes] = useState(null); // admin-only: notes for the open team modal entry

  // FORM
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("");

  // NEW MODAL STATE
  const [showAddModal, setShowAddModal] = useState(false);

  // EDIT
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  // MODAL
  const [selected, setSelected] = useState(null);
  const [modalNotes, setModalNotes] = useState("");

  // TEAM MODAL
  const [teamSelected, setTeamSelected] = useState(null);

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
    setCompany("");
    setContact("");
    setEmail("");
    setPhone("");
    setNextDate("");
    setNotes("");
    setCategory("");
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
    if (owner?.email && owner.notifyCollabRequest !== false) {
      sendNotificationEmail(
        owner.email,
        `${requesterName} wants to collaborate on ${c.company}`,
        `<p>${requesterName} has requested to collaborate on <strong>${c.company}</strong>. Log in to your CRM dashboard to approve or deny.</p>`
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
    if (requester?.email && requester.notifyCollabApproved !== false) {
      sendNotificationEmail(
        requester.email,
        `You can now collaborate on ${c?.company || "an entry"}`,
        `<p>Your request to collaborate on <strong>${c?.company || "this entry"}</strong> was approved. It now shows up in your My Dashboard.</p>`
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

  const openTeamModal = async (c) => {
    setTeamSelected(c);
    setTeamNotes(null);
    if (role === "admin") {
      const noteSnap = await getDoc(doc(db, "customers", c.id, "private", "data"));
      setTeamNotes(noteSnap.exists() ? noteSnap.data() : { notes: "", notesHistory: [] });
    }
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
    if (!company || !contact || !nextDate) {
      return alert("Please fill required fields");
    }

    const ref = await addDoc(col, {
      company,
      contact,
      email,
      phone,
      category: category || null,
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

    clearForm();
    setShowAddModal(false);

    showToast("Customer added");
    loadCustomers(uid, role === "admin");
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setEditData({
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

  const openModal = async (c, e) => {
    if (e?.target?.tagName === "BUTTON" || e?.target?.tagName === "INPUT") return;
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
        (c.company || "").toLowerCase().includes(q) ||
        (c.contact || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [customers, searchQuery, uid]);

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
        (c.company || "").toLowerCase().includes(q) ||
        (c.contact || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [customers, searchQuery, teamFilterOwner]);

  const ownerLabel = (ownerId) => {
    if (ownerId === uid) return "You";
    const u = users.find(u => u.id === ownerId);
    if (!u) return "Teammate";
    return u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email;
  };

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
          <input className="field" value={nameFirst} onChange={e => setNameFirst(e.target.value)} />

          <label className="field-label">Last Name</label>
          <input className="field" value={nameLast} onChange={e => setNameLast(e.target.value)} />

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
        </div>
      )}

      {view === "personal" && (
        <>
          {/* ADD CUSTOMER BUTTON */}
          <div style={{ marginBottom: 20 }}>
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>ADD CUSTOMER</button>
          </div>

          {/* ADD MODAL */}
          {showAddModal && (
            <div className="modal-overlay">
              <div className="modal-card">
                <button className="modal-close" onClick={() => { clearForm(); setShowAddModal(false); }}>✕</button>

                <h3 className="modal-title">Add Customer</h3>

                <input className="field" placeholder="Company" value={company} onChange={e => setCompany(e.target.value)} />
                <input className="field" placeholder="Contact" value={contact} onChange={e => setContact(e.target.value)} />
                <input className="field" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
                <input className="field" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
                <select className="field" value={category} onChange={e => setCategory(e.target.value)}>
                  <option value="">Select category...</option>
                  {CATEGORY_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
                <input className="field" type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} />
                <input className="field" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />

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
                placeholder="Search company or contact..."
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
                onClick={(e) => openModal(c, e)}
                className={`customer-card ${barClass}`}
              >

                {/* LEFT */}
                <div className="customer-card-left">
                  {!isOwner && <div className="owner-badge" style={{ marginBottom: 6 }}>🤝 Collaborating with {ownerLabel(c.ownerId)}</div>}
                  {editingId === c.id ? (
                    <>
                      <input className="field" value={editData.company} onChange={e => setEditData({ ...editData, company: e.target.value })} />
                      <input className="field" value={editData.contact} onChange={e => setEditData({ ...editData, contact: e.target.value })} />
                      <input className="field" value={editData.email} onChange={e => setEditData({ ...editData, email: e.target.value })} />
                      <input className="field" value={editData.phone} onChange={e => setEditData({ ...editData, phone: e.target.value })} />

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
                      <div className="customer-name">{c.company}</div>

                      <div className="customer-contact">
                        {c.contact}
                      </div>

                      <div className="customer-meta">
                        {c.email || ""} | {formatPhone(c.phone)}
                      </div>

                      {c.category && <span className="role-badge" style={{ marginTop: 6 }}>{c.category}</span>}

                      <div className="customer-dates">Next: {formatDate(c.nextCheckIn)}</div>
                      <div className="customer-dates">Last: {formatDate(c.lastContact)}</div>
                    </>
                  )}
                </div>

                {/* MIDDLE */}
                <div className="customer-card-middle">
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
                <div className="customer-card-right">
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

                <h2 className="modal-title">{selected.company}</h2>

                <p>{selected.contact}</p>
                <p>{selected.email}</p>
                <p>{selected.phone}</p>

                <h4 className="field-label">Notes</h4>
                {notesById[selected.id]?.notesAuthorName && (
                  <p className="private-note-hint">Last written by {notesById[selected.id].notesAuthorName}</p>
                )}
                <textarea
                  className="field"
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
                placeholder="Search company or contact..."
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
                onClick={() => openTeamModal(c)}
                className={`customer-card ${barClass}`}
              >
                <div className="customer-card-left">
                  <div className="customer-name">{c.company}</div>
                  <div className="customer-contact">{c.contact}</div>
                  <div className="customer-meta">
                    {c.email || ""} | {formatPhone(c.phone)}
                  </div>
                  {c.category && <span className="role-badge" style={{ marginTop: 6 }}>{c.category}</span>}
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

          {teamSelected && (
            <div className="modal-overlay">
              <div className="modal-card modal-wide">
                <button className="modal-close" onClick={() => { setTeamSelected(null); setTeamNotes(null); }}>✕</button>

                <h2 className="modal-title">{teamSelected.company}</h2>
                <p className="modal-subtitle">Owned by {ownerLabel(teamSelected.ownerId)}</p>

                <p>{teamSelected.contact}</p>
                <p>{teamSelected.email}</p>
                <p>{teamSelected.phone}</p>

                <h4 className="field-label">Activity</h4>
                {(teamSelected.activityLog || []).length === 0 && (
                  <p className="private-note-hint">No activity yet.</p>
                )}
                {(teamSelected.activityLog || []).map((a, i) => (
                  <div key={i} className="notes-history-item">
                    <div>{a.type} via {a.method}</div>
                    <div className="notes-history-date">{a.timestamp}</div>
                  </div>
                ))}

                {role === "admin" ? (
                  <>
                    <h4 className="field-label" style={{ marginTop: 12 }}>Notes (visible to you as admin)</h4>
                    {teamNotes ? (
                      <>
                        <p>{teamNotes.notes || "(no notes yet)"}</p>
                        {teamNotes.notesAuthorName && (
                          <p className="private-note-hint">Last written by {teamNotes.notesAuthorName}</p>
                        )}
                        {(teamNotes.notesHistory || []).length > 0 && (
                          <>
                            <h4 className="field-label" style={{ marginTop: 12 }}>Notes History</h4>
                            {teamNotes.notesHistory.map((h, i) => (
                              <div key={i} className="notes-history-item">
                                <div>{h.text}</div>
                                <div className="notes-history-date">{h.authorName || "Unknown"} · {h.date}</div>
                              </div>
                            ))}
                          </>
                        )}
                      </>
                    ) : (
                      <p>Loading...</p>
                    )}
                  </>
                ) : (teamSelected.collaboratorIds || []).includes(uid) ? (
                  <p className="private-note-hint" style={{ marginTop: 12 }}>
                    🤝 You're a collaborator — open this from My Dashboard to view and edit notes.
                  </p>
                ) : (
                  <p className="private-note-hint" style={{ marginTop: 12 }}>
                    🔒 Notes are private to {ownerLabel(teamSelected.ownerId)}.
                  </p>
                )}

                {teamSelected.ownerId !== uid && !(teamSelected.collaboratorIds || []).includes(uid) && (
                  <div className="modal-actions">
                    <button
                      className="btn btn-primary"
                      disabled={requestedIds.has(teamSelected.id)}
                      onClick={() => requestCollaborate(teamSelected)}
                    >
                      {requestedIds.has(teamSelected.id) ? "Requested" : "Request to Collaborate"}
                    </button>
                  </div>
                )}
              </div>
            </div>
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
              placeholder="First name"
              value={newUserFirstName}
              onChange={e => setNewUserFirstName(e.target.value)}
            />

            <label className="field-label">Last Name (optional)</label>
            <input
              className="field"
              placeholder="Last name"
              value={newUserLastName}
              onChange={e => setNewUserLastName(e.target.value)}
            />

            <label className="field-label">Email</label>
            <input
              className="field"
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
