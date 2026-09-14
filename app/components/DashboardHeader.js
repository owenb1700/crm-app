"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth, db } from "../../lib/firebase";
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import UserSettingsModal from "./UserSettingsModal";

const ROLE_LABELS = { admin: "Admin", member: "Salesperson", estimating: "Estimating Department" };
const roleLabel = (role) => ROLE_LABELS[role] || role;

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

// The alerts bell + avatar/user-settings menu, meant to be dropped into any
// dashboard page's header-actions alongside whatever that page already has
// there. Self-contained: given just the signed-in user's uid, it loads its
// own profile and notifications rather than requiring every page to thread
// that state through. Pending collaboration requests are the one piece of
// data only the main dashboard already has loaded (scanning every
// customer's collabRequests subcollection is too expensive to redo on
// every page) -- pages that don't pass them just show notifications alone.
export default function DashboardHeader({ uid, pendingRequests = [], onApproveRequest, onDenyRequest }) {
  const router = useRouter();

  const [profile, setProfile] = useState(null);

  const [notifications, setNotifications] = useState([]);
  const [notificationsError, setNotificationsError] = useState(null);
  const [showUserSettings, setShowUserSettings] = useState(false);

  useEffect(() => {
    if (!uid) return;

    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists()) return;
        setProfile(snap.data());
      } catch {
        // Profile load failing shouldn't break the header -- name/role just
        // won't show. The page's own auth guard already handles a truly
        // invalid session.
      }
    })();

    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "notifications"), where("userId", "==", uid)));
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        setNotifications(list);
        setNotificationsError(null);
      } catch (err) {
        // A broken alerts bell shouldn't take down the whole page, but the
        // failure still needs to be visible -- an empty list must never be
        // indistinguishable from "nothing to show."
        setNotificationsError(err.message || "Couldn't load alerts.");
      }
    })();
  }, [uid]);

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

  const logout = async () => {
    clearSession();
    await signOut(auth);
    router.push("/");
  };

  const unreadNotificationCount = notifications.filter(n => !n.read).length;
  const alertsCount = pendingRequests.length + unreadNotificationCount;
  const role = profile?.role;

  return (
    <>
      <div className="alerts-menu">
        <button className="avatar-circle" style={{ position: "relative" }}>
          🔔
          {alertsCount > 0 && <span className="alerts-badge">{alertsCount}</span>}
        </button>
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

              {pendingRequests.length > 0 && (
                <>
                  <div className="field-label" style={{ marginTop: 8 }}>Pending Collaboration Requests</div>
                  {pendingRequests.map(r => (
                    <div key={`${r.customerId}-${r.id}`} className="notes-history-item" style={{ marginTop: 6 }}>
                      <div>
                        <strong>{r.requesterName}</strong> wants to collaborate on {r.label || "an entry"}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        <button className="btn btn-primary" onClick={() => onApproveRequest?.(r.customerId, r)}>Approve</button>
                        <button className="btn btn-secondary" onClick={() => onDenyRequest?.(r.customerId, r)}>Deny</button>
                      </div>
                    </div>
                  ))}
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
                      if (n.link) router.push(n.link);
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
          {`${profile?.firstName?.[0] || ""}${profile?.lastName?.[0] || ""}`.toUpperCase()}
        </button>
        <div className="avatar-dropdown">
          <div className="avatar-dropdown-card">
            <div className="avatar-dropdown-name">
              {profile?.firstName} {profile?.lastName}
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

      {showUserSettings && profile && (
        <UserSettingsModal
          uid={uid}
          profile={profile}
          onClose={() => setShowUserSettings(false)}
          onSaved={(patch) => setProfile(prev => ({ ...(prev || {}), ...patch }))}
        />
      )}
    </>
  );
}
