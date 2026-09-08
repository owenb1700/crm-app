"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../../../../lib/firebase";
import { doc, getDoc, getDocs, collection } from "firebase/firestore";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

export default function TowersPage() {
  const router = useRouter();

  const [loadError, setLoadError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const [customers, setCustomers] = useState([]);
  const [pipelineEntries, setPipelineEntries] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");

  const loadAll = async () => {
    const [customersSnap, pipelineSnap] = await Promise.all([
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "pipeline"))
    ]);
    setCustomers(customersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setPipelineEntries(pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setLoaded(true);
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

        await loadAll();
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading the towers list.");
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every project/pipeline entry with a serial number is one work record
  // for a tower. Group them by serial (case-insensitive) into one card per
  // physical tower, with a running count of how much work references it.
  const towersBySerial = {};
  [...customers, ...pipelineEntries].forEach(entry => {
    const serial = (entry.serialNumber || "").trim();
    if (!serial) return;
    const key = serial.toLowerCase();
    if (!towersBySerial[key]) {
      towersBySerial[key] = {
        serial,
        manufacturer: entry.towerManufacturer || "",
        model: entry.modelNumber || "",
        address: entry.projectAddress || "",
        count: 0
      };
    }
    const t = towersBySerial[key];
    if (!t.manufacturer && entry.towerManufacturer) t.manufacturer = entry.towerManufacturer;
    if (!t.model && entry.modelNumber) t.model = entry.modelNumber;
    if (!t.address && entry.projectAddress) t.address = entry.projectAddress;
    t.count += 1;
  });

  const q = searchQuery.trim().toLowerCase();
  const allTowers = Object.values(towersBySerial);

  const results = q
    ? allTowers
        .map(t => {
          const fields = [t.serial, t.manufacturer, t.model, t.address].map(s => s.toLowerCase());
          const idx = Math.min(...fields.map(f => {
            const i = f.indexOf(q);
            return i === -1 ? Infinity : i;
          }));
          if (idx === Infinity) return null;
          return { tower: t, score: idx === 0 ? 0 : 1 };
        })
        .filter(Boolean)
        .sort((a, b) => a.score - b.score || a.tower.serial.localeCompare(b.tower.serial))
        .map(r => r.tower)
    : allTowers.slice().sort((a, b) => a.serial.localeCompare(b.serial));

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load towers</h3>
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
          <h1 className="dashboard-title">Directory — Towers</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory")}>← Back to Directory</button>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="field"
          placeholder="Search by serial number, manufacturer, model, or address..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ flex: 1, marginBottom: 0 }}
        />
      </div>

      {results.length === 0 && (
        <p className="private-note-hint">
          {allTowers.length === 0
            ? "No towers with a serial number on file yet."
            : "No towers found."}
        </p>
      )}

      {results.map(t => (
        <div
          key={t.serial}
          className="customer-card"
          onClick={() => router.push(`/dashboard/directory/tower/${encodeURIComponent(t.serial)}`)}
          style={{ cursor: "pointer" }}
        >
          <div className="customer-card-left">
            <div className="customer-name">Serial #{t.serial}</div>
            <span className="role-badge role-badge-admin" style={{ marginTop: 6 }}>{t.manufacturer || "Unknown Manufacturer"}</span>
          </div>
          <div className="customer-card-middle">
            <div className="private-note-hint">{t.model || "No model on file"}</div>
            <div className="private-note-hint">{t.count} work record{t.count === 1 ? "" : "s"}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
