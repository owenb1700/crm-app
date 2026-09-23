"use client";

import { useEffect, useState } from "react";
import { auth } from "../../lib/firebase";
import { getDeviceId } from "../../lib/deviceId";

// The machines that can currently sign in to this admin account without an
// emailed code, and a way to throw one off. Shown to admins only, because
// they're the only ones asked for a code in the first place.
export default function TrustedDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const authHeader = async () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${await auth.currentUser.getIdToken()}`
  });

  const load = async () => {
    try {
      const res = await fetch(`/api/login-code/devices?deviceId=${encodeURIComponent(getDeviceId())}`, {
        headers: await authHeader()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load your devices");
      setDevices(data.devices || []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (auth.currentUser) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forget = async (id) => {
    try {
      const res = await fetch("/api/login-code/devices", {
        method: "DELETE",
        headers: await authHeader(),
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't remove that device");
      setDevices(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const day = value => {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
  };

  return (
    <section className="settings-section">
      <h4 className="settings-section-title">Trusted devices</h4>
      <p className="settings-hint">
        Signing in to an admin account on a new device needs a code emailed to you. After that, the
        device is trusted for 30 days. Remove one here and its next sign-in will ask for a code again.
      </p>

      {error && <p className="settings-status is-error">{error}</p>}
      {loading && <p className="settings-hint">Loading your devices…</p>}
      {!loading && !error && devices.length === 0 && (
        <p className="settings-hint">No trusted devices — every sign-in is asking for a code.</p>
      )}

      {devices.map(d => (
        <div key={d.id} className="notes-history-item notes-history-row">
          <div>
            <div>
              <strong>{d.label || "Unknown device"}</strong>
              {d.current && <span className="role-badge" style={{ marginLeft: 8 }}>This device</span>}
            </div>
            <div className="notes-history-date">
              {d.lastUsedAt && `Last used ${day(d.lastUsedAt)} · `}Trusted until {day(d.trustedUntil)}
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => forget(d.id)}>Remove</button>
        </div>
      ))}
    </section>
  );
}
