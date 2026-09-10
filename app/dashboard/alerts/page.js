"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../../../lib/firebase";
import { collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import DashboardHeader from "../../components/DashboardHeader";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

const adjustWeekend = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2);
  if (day === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
};

const toDateInputValue = (date) => {
  if (!date) return "";
  if (date?.seconds) return new Date(date.seconds * 1000).toISOString().split("T")[0];
  return date.slice ? date.slice(0, 10) : date;
};

// Every nextCheckIn across projects and Won pipeline entries -- past and
// upcoming alike -- in one place: the same "what's this alert for and when
// does it fire" data that otherwise only surfaces piecemeal (Home calendar,
// My Dashboard, the bell). Scoped to the current user's own projects/
// collaborations and pipeline responsibility, same as Home's calendar --
// not an admin-wide view.
export default function AllAlerts() {
  const router = useRouter();

  const [uid, setUid] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [savingId, setSavingId] = useState(null);

  const [alerts, setAlerts] = useState([]);
  const [search, setSearch] = useState("");
  const [timeFilter, setTimeFilter] = useState("all"); // 'all' | 'upcoming' | 'past'
  const [editedDates, setEditedDates] = useState({});

  const loadAlerts = async (currentUid) => {
    const [customersSnap, pipelineSnap] = await Promise.all([
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "pipeline"))
    ]);

    const customers = customersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.ownerId === currentUid || (c.collaboratorIds || []).includes(currentUid))
      .filter(c => c.nextCheckIn)
      .map(c => ({
        key: `project-${c.id}`,
        kind: "project",
        id: c.id,
        name: c.projectName || c.company || "Untitled project",
        company: c.company || "",
        badge: c.category || "",
        nextCheckIn: c.nextCheckIn,
        link: `/dashboard/project/${c.id}`,
        // Firestore rules only let the owner (or an admin) change a
        // project's date -- a collaborator can see it here but not edit it.
        canEditDate: c.ownerId === currentUid
      }));

    // Same responsibility rule as the Home calendar's myCalendarProjects --
    // only Won entries ever get a nextCheckIn, and it's whoever's actually
    // on the hook for the relationship (point person, then salesperson,
    // then owner) who sees it.
    const pipeline = pipelineSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.outcome === "Won" && p.nextCheckIn)
      .filter(p => (p.projectPointPersonId || p.salespersonId || p.ownerId) === currentUid)
      .map(p => ({
        key: `pipeline-${p.id}`,
        kind: "pipeline",
        id: p.id,
        name: p.title || "Untitled pipeline entry",
        company: p.company || "",
        badge: "Pipeline",
        nextCheckIn: p.nextCheckIn,
        link: `/dashboard/pipeline/${p.id}`,
        // Pipeline entries are editable by any signed-in user, so anyone
        // who sees this (already scoped to responsibility above) can edit it.
        canEditDate: true
      }));

    const combined = [...customers, ...pipeline]
      .sort((a, b) => new Date(a.nextCheckIn) - new Date(b.nextCheckIn));

    setAlerts(combined);
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
        if (profileSnap.data().disabled) {
          clearSession();
          await signOut(auth);
          router.push("/");
          return;
        }

        await loadAlerts(user.uid);
        setLoaded(true);
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading alerts.");
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveDate = async (alert) => {
    const newDate = editedDates[alert.key];
    if (!newDate) return;

    setSavingId(alert.key);
    try {
      const collectionName = alert.kind === "project" ? "customers" : "pipeline";
      const adjusted = adjustWeekend(newDate);
      await updateDoc(doc(db, collectionName, alert.id), { nextCheckIn: adjusted });

      setAlerts(prev => prev
        .map(a => (a.key === alert.key ? { ...a, nextCheckIn: adjusted } : a))
        .sort((a, b) => new Date(a.nextCheckIn) - new Date(b.nextCheckIn)));
      setEditedDates(prev => {
        const next = { ...prev };
        delete next[alert.key];
        return next;
      });
    } catch (err) {
      alert(err.message || "Couldn't save that date.");
    } finally {
      setSavingId(null);
    }
  };

  const now = new Date();
  const q = search.trim().toLowerCase();
  const filtered = alerts
    .filter(a => !q || a.name.toLowerCase().includes(q) || a.company.toLowerCase().includes(q))
    .filter(a => {
      if (timeFilter === "upcoming") return new Date(a.nextCheckIn) >= now;
      if (timeFilter === "past") return new Date(a.nextCheckIn) < now;
      return true;
    });

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load alerts</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <div className="dashboard-page">Loading...</div>;
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">All Alerts</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>← Back to Dashboard</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="toolbar">
        <input
          className="field"
          placeholder="Search by project or company..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, marginBottom: 0 }}
        />
        <select
          className="field"
          style={{ maxWidth: 160, marginBottom: 0 }}
          value={timeFilter}
          onChange={e => setTimeFilter(e.target.value)}
        >
          <option value="all">All</option>
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
        </select>
      </div>

      {filtered.length === 0 && (
        <p className="private-note-hint">{alerts.length === 0 ? "No alerts yet." : "No alerts match that search/filter."}</p>
      )}

      {filtered.map(a => {
        const isPast = new Date(a.nextCheckIn) < now;
        return (
        <div key={a.key} className="customer-card">
          <div className="customer-card-left" style={{ cursor: "pointer" }} onClick={() => router.push(a.link)}>
            <div className="customer-name">{a.name}</div>
            {a.badge && <span className="role-badge" style={{ marginTop: 6 }}>{a.badge}</span>}
            <span className={`role-badge ${isPast ? "role-badge-admin" : ""}`} style={{ marginTop: 4 }}>
              {isPast ? "Past" : "Upcoming"}
            </span>
          </div>
          <div className="customer-card-middle">
            {a.company && <div className="private-note-hint">{a.company}</div>}
            <div className="customer-dates">Alert set for: {a.nextCheckIn.slice ? a.nextCheckIn.slice(0, 10) : a.nextCheckIn}</div>
          </div>
          <div className="customer-card-right" onClick={e => e.stopPropagation()}>
            {a.canEditDate ? (
              <>
                <input
                  className="field"
                  type="date"
                  style={{ marginBottom: 0, width: 160 }}
                  value={editedDates[a.key] !== undefined ? editedDates[a.key] : toDateInputValue(a.nextCheckIn)}
                  onChange={e => setEditedDates(prev => ({ ...prev, [a.key]: e.target.value }))}
                />
                <button
                  className="btn btn-secondary"
                  disabled={editedDates[a.key] === undefined || savingId === a.key}
                  onClick={() => saveDate(a)}
                >
                  {savingId === a.key ? "Saving..." : "Save"}
                </button>
              </>
            ) : (
              <span className="private-note-hint">Only the owner can change this date</span>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}
