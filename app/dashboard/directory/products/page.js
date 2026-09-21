"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../../../../lib/firebase";
import { doc, getDoc, getDocs, collection, addDoc } from "firebase/firestore";
import { PRODUCT_TYPES, PRODUCT_MANUFACTURERS } from "../../../../lib/products";
import DashboardHeader from "../../../components/DashboardHeader";
import ExportButtons from "../../../components/ExportButtons";
import { downloadTable, csvDateStamp } from "../../../../lib/csv";
import MobileNav from "../../../components/MobileNav";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

export default function ProductsPage() {
  const router = useRouter();

  const [uid, setUid] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const [products, setProducts] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilters, setTypeFilters] = useState(new Set());
  const [manufacturerFilters, setManufacturerFilters] = useState(new Set());

  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [newManufacturer, setNewManufacturer] = useState("");
  const [newModel, setNewModel] = useState("");

  const loadAll = async () => {
    const snap = await getDocs(collection(db, "products"));
    setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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

        await loadAll();
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading products.");
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addProduct = async () => {
    const missing = [];
    if (!newName.trim()) missing.push("Name");
    if (!newType) missing.push("Type");
    if (!newManufacturer.trim()) missing.push("Manufacturer");
    if (missing.length) {
      return alert(`Please fill in the following required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
    }

    const ref = await addDoc(collection(db, "products"), {
      name: newName.trim(),
      type: newType,
      manufacturer: newManufacturer.trim(),
      model: newModel.trim() || null,
      gpm: null,
      tempIn: null,
      tempOut: null,
      designDetails: null,
      notes: null,
      createdAt: new Date().toISOString(),
      createdBy: uid
    });

    setNewName("");
    setNewType("");
    setNewManufacturer("");
    setNewModel("");
    setShowAddModal(false);
    router.push(`/dashboard/directory/product/${ref.id}`);
  };

  const knownModels = Array.from(new Set(products.map(p => p.model).filter(Boolean))).sort();
  const knownManufacturers = Array.from(
    new Set([...PRODUCT_MANUFACTURERS, ...products.map(p => p.manufacturer).filter(Boolean)])
  ).sort();

  const byTypeAndManufacturer = products
    .filter(p => typeFilters.size === 0 || typeFilters.has(p.type))
    .filter(p => manufacturerFilters.size === 0 || manufacturerFilters.has(p.manufacturer));

  const toggleTypeFilter = (type) => {
    setTypeFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  const toggleManufacturerFilter = (manufacturer) => {
    setManufacturerFilters(prev => {
      const next = new Set(prev);
      if (next.has(manufacturer)) next.delete(manufacturer); else next.add(manufacturer);
      return next;
    });
  };

  const searchableFields = (p) => [
    p.name, p.type, p.manufacturer, p.model, p.gpm, p.tempIn, p.tempOut, p.designDetails, p.notes
  ].map(v => (v || "").toString().toLowerCase());

  const q = searchQuery.trim().toLowerCase();
  const results = q
    ? byTypeAndManufacturer
        .map(p => {
          const fields = searchableFields(p);
          const idx = Math.min(...fields.map(f => {
            const i = f.indexOf(q);
            return i === -1 ? Infinity : i;
          }));
          if (idx === Infinity) return null;
          return { product: p, score: idx === 0 ? 0 : 1 };
        })
        .filter(Boolean)
        .sort((a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name))
        .map(r => r.product)
    : byTypeAndManufacturer.slice().sort((a, b) => a.name.localeCompare(b.name));

  const exportProducts = (format) => downloadTable({
    format,
    filename: `product-options${q ? "-filtered" : ""}-${csvDateStamp()}`,
    sheetName: "Product Options",
    headers: ["Name", "Type", "Manufacturer", "Model", "GPM", "Temp in", "Temp out", "Design details", "Notes"],
    rows: results.map(p => [p.name, p.type, p.manufacturer, p.model, p.gpm, p.tempIn, p.tempOut, p.designDetails, p.notes])
  });

  // Nested Manufacturer -> Type -> Model so browsing follows how the
  // catalog is actually organized. Anything missing a value at a given
  // level falls into an "Unspecified" bucket sorted to the end of it.
  const sortKeys = (keys, fallback) => keys.sort((a, b) => {
    if (a === fallback) return 1;
    if (b === fallback) return -1;
    return a.localeCompare(b);
  });

  const NO_MANUFACTURER = "No Manufacturer Specified";
  const NO_TYPE = "No Type Specified";
  const NO_MODEL = "No Model Specified";

  const manufacturerGroups = new Map();
  results.forEach(p => {
    const mfrKey = p.manufacturer || NO_MANUFACTURER;
    if (!manufacturerGroups.has(mfrKey)) manufacturerGroups.set(mfrKey, new Map());
    const typeGroups = manufacturerGroups.get(mfrKey);

    const typeKey = p.type || NO_TYPE;
    if (!typeGroups.has(typeKey)) typeGroups.set(typeKey, new Map());
    const modelGroups = typeGroups.get(typeKey);

    const modelKey = p.model || NO_MODEL;
    if (!modelGroups.has(modelKey)) modelGroups.set(modelKey, []);
    modelGroups.get(modelKey).push(p);
  });

  const groupedResults = sortKeys(Array.from(manufacturerGroups.keys()), NO_MANUFACTURER).map(mfrKey => ({
    manufacturer: mfrKey,
    types: sortKeys(Array.from(manufacturerGroups.get(mfrKey).keys()), NO_TYPE).map(typeKey => ({
      type: typeKey,
      models: sortKeys(Array.from(manufacturerGroups.get(mfrKey).get(typeKey).keys()), NO_MODEL).map(modelKey => ({
        model: modelKey,
        products: manufacturerGroups.get(mfrKey).get(typeKey).get(modelKey)
      }))
    }))
  }));

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load product options</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>Back to My Projects</button>
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
          <MobileNav uid={uid} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Directory — Product Options</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>← Back to My Projects</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="toolbar">
        <input
          className="field"
          placeholder="Search product options..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ flex: 1, marginBottom: 0 }}
        />
        <ExportButtons label="this page" buttonText="Export page" onExport={exportProducts} disabled={!results.length} />
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Add Product Option</button>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ width: 220, flexShrink: 0 }}>
          <div className="admin-card">
            <h4 className="field-label" style={{ marginTop: 0 }}>Type</h4>
            {PRODUCT_TYPES.map(opt => (
              <label key={opt} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={typeFilters.has(opt)} onChange={() => toggleTypeFilter(opt)} />
                {opt}
              </label>
            ))}

            <h4 className="field-label" style={{ marginTop: 16 }}>Manufacturer</h4>
            {knownManufacturers.map(opt => (
              <label key={opt} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={manufacturerFilters.has(opt)} onChange={() => toggleManufacturerFilter(opt)} />
                {opt}
              </label>
            ))}

            {(typeFilters.size > 0 || manufacturerFilters.size > 0) && (
              <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => { setTypeFilters(new Set()); setManufacturerFilters(new Set()); }}>
                Clear Filters
              </button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {groupedResults.length === 0 && (
            <p className="private-note-hint">No products found.</p>
          )}

          {groupedResults.map(({ manufacturer, types }) => (
            <div key={manufacturer} style={{ marginBottom: 24 }}>
              <h2 className="modal-title" style={{ marginTop: 20 }}>{manufacturer}</h2>

              {types.map(({ type, models }) => (
                <div key={type} style={{ marginLeft: 12, marginBottom: 12 }}>
                  <h3 className="modal-title" style={{ fontSize: 16, marginTop: 12 }}>{type}</h3>

                  {models.map(({ model, products: modelProducts }) => (
                    <div key={model} style={{ marginLeft: 12, marginBottom: 16 }}>
                      <h4 className="field-label" style={{ marginTop: 12 }}>{model} ({modelProducts.length})</h4>
                      {modelProducts.map(p => (
                        <div
                          key={p.id}
                          className="customer-card"
                          onClick={() => router.push(`/dashboard/directory/product/${p.id}`)}
                          style={{ cursor: "pointer" }}
                        >
                          <div className="customer-card-left">
                            <div className="customer-name">{p.name}</div>
                            <span className="role-badge role-badge-admin" style={{ marginTop: 6 }}>{p.type}</span>
                          </div>
                          <div className="customer-card-middle">
                            {p.gpm && <div className="private-note-hint">{p.gpm} GPM</div>}
                            {(p.tempIn || p.tempOut) && (
                              <div className="private-note-hint">
                                {p.tempIn ? `In: ${p.tempIn}°` : ""}{p.tempIn && p.tempOut ? " / " : ""}{p.tempOut ? `Out: ${p.tempOut}°` : ""}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <button className="modal-close" onClick={() => setShowAddModal(false)}>✕</button>
            <h3 className="modal-title">Add Product Option</h3>

            <label className="field-label">Name</label>
            <input className="field" autoComplete="off" value={newName} onChange={e => setNewName(e.target.value)} />

            <label className="field-label">Type</label>
            <select className="field" value={newType} onChange={e => setNewType(e.target.value)}>
              <option value="">Select type...</option>
              {PRODUCT_TYPES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>

            <label className="field-label">Manufacturer</label>
            <input className="field" list="add-product-manufacturers" autoComplete="off" value={newManufacturer} onChange={e => setNewManufacturer(e.target.value)} />
            <datalist id="add-product-manufacturers">
              {PRODUCT_MANUFACTURERS.map(opt => <option key={opt} value={opt} />)}
            </datalist>

            <label className="field-label">Model</label>
            <input className="field" list="add-product-models" autoComplete="off" value={newModel} onChange={e => setNewModel(e.target.value)} />
            <datalist id="add-product-models">
              {knownModels.map(opt => <option key={opt} value={opt} />)}
            </datalist>

            <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={addProduct}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
