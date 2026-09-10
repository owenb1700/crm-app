"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../../../../../lib/firebase";
import { doc, getDoc, getDocs, collection, updateDoc, deleteDoc } from "firebase/firestore";
import { PRODUCT_TYPES, PRODUCT_MANUFACTURERS } from "../../../../../lib/products";
import DashboardHeader from "../../../../components/DashboardHeader";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

export default function ProductDetail() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id;

  const [uid, setUid] = useState(null);
  const [role, setRole] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const [product, setProduct] = useState(null);
  const [allProducts, setAllProducts] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});

  const loadProduct = async () => {
    const snap = await getDoc(doc(db, "products", productId));
    if (!snap.exists()) {
      setNotFound(true);
      return;
    }
    setProduct({ id: snap.id, ...snap.data() });

    const allSnap = await getDocs(collection(db, "products"));
    setAllProducts(allSnap.docs.map(d => ({ id: d.id, ...d.data() })));
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
        setRole(profileSnap.data().role || "member");

        await loadProduct();
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading this product.");
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const startEdit = () => {
    setEditData({
      name: product.name || "",
      type: product.type || "",
      manufacturer: product.manufacturer || "",
      model: product.model || "",
      gpm: product.gpm || "",
      tempIn: product.tempIn || "",
      tempOut: product.tempOut || "",
      designDetails: product.designDetails || "",
      notes: product.notes || ""
    });
    setIsEditing(true);
  };

  const saveEdit = async () => {
    const missing = [];
    if (!editData.name.trim()) missing.push("Name");
    if (!editData.type) missing.push("Type");
    if (!editData.manufacturer.trim()) missing.push("Manufacturer");
    if (missing.length) {
      return alert(`Please fill in the following required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
    }

    await updateDoc(doc(db, "products", productId), {
      name: editData.name.trim(),
      type: editData.type,
      manufacturer: editData.manufacturer.trim(),
      model: editData.model.trim() || null,
      gpm: editData.gpm || null,
      tempIn: editData.tempIn || null,
      tempOut: editData.tempOut || null,
      designDetails: editData.designDetails || null,
      notes: editData.notes || null
    });

    setIsEditing(false);
    await loadProduct();
  };

  const deleteProduct = async () => {
    if (!window.confirm(`Delete "${product.name}"? This can't be undone.`)) return;
    await deleteDoc(doc(db, "products", productId));
    router.push("/dashboard/directory/products");
  };

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load this product</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory/products")}>Back to Products</button>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Product not found</h3>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory/products")}>Back to Products</button>
        </div>
      </div>
    );
  }

  if (!product || !role) {
    return <div className="dashboard-page">Loading...</div>;
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Product</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory/products")}>← Back to Products</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <div className="project-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div>
              <h2 className="modal-title" style={{ marginBottom: 2 }}>{product.name}</h2>
              <span className="role-badge role-badge-admin" style={{ marginTop: 6 }}>{product.type}</span>
              {product.manufacturer && <p className="modal-subtitle" style={{ marginTop: 6 }}>{product.manufacturer}{product.model ? ` — ${product.model}` : ""}</p>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {!isEditing && (
                <button className="btn btn-primary" onClick={startEdit}>Edit</button>
              )}
              {isEditing && (
                <>
                  <button className="btn btn-primary" onClick={saveEdit}>Save</button>
                  <button className="btn btn-secondary" onClick={() => setIsEditing(false)}>Cancel</button>
                </>
              )}
              {!isEditing && role === "admin" && (
                <button className="btn btn-danger" onClick={deleteProduct}>Delete</button>
              )}
            </div>
          </div>
        </div>

        {isEditing ? (
          <div className="project-section">
            <h4 className="field-label">Name</h4>
            <input className="field" autoComplete="off" value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} />

            <h4 className="field-label">Type</h4>
            <select className="field" value={editData.type} onChange={e => setEditData({ ...editData, type: e.target.value })}>
              <option value="">Select type...</option>
              {PRODUCT_TYPES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>

            <h4 className="field-label">Manufacturer</h4>
            <input className="field" list="detail-product-manufacturers" autoComplete="off" value={editData.manufacturer} onChange={e => setEditData({ ...editData, manufacturer: e.target.value })} />
            <datalist id="detail-product-manufacturers">
              {PRODUCT_MANUFACTURERS.map(opt => <option key={opt} value={opt} />)}
            </datalist>

            <h4 className="field-label">Model</h4>
            <input className="field" list="detail-product-models" autoComplete="off" value={editData.model} onChange={e => setEditData({ ...editData, model: e.target.value })} />
            <datalist id="detail-product-models">
              {Array.from(new Set(allProducts.map(p => p.model).filter(Boolean))).sort().map(opt => <option key={opt} value={opt} />)}
            </datalist>

            <h4 className="field-label">GPM</h4>
            <input className="field" autoComplete="off" value={editData.gpm} onChange={e => setEditData({ ...editData, gpm: e.target.value })} />

            <h4 className="field-label">Temp In (°F)</h4>
            <input className="field" autoComplete="off" value={editData.tempIn} onChange={e => setEditData({ ...editData, tempIn: e.target.value })} />

            <h4 className="field-label">Temp Out (°F)</h4>
            <input className="field" autoComplete="off" value={editData.tempOut} onChange={e => setEditData({ ...editData, tempOut: e.target.value })} />

            <h4 className="field-label">Design Details</h4>
            <textarea className="field" style={{ width: "100%", height: 100 }} value={editData.designDetails} onChange={e => setEditData({ ...editData, designDetails: e.target.value })} />

            <h4 className="field-label">Notes</h4>
            <textarea className="field" style={{ width: "100%", height: 80 }} value={editData.notes} onChange={e => setEditData({ ...editData, notes: e.target.value })} />
          </div>
        ) : (
          <div className="project-section">
            <h4 className="field-label">Design Specs</h4>
            <p><strong>GPM:</strong> {product.gpm || "—"}</p>
            <p><strong>Temp In:</strong> {product.tempIn ? `${product.tempIn}°F` : "—"}</p>
            <p><strong>Temp Out:</strong> {product.tempOut ? `${product.tempOut}°F` : "—"}</p>
            <p><strong>Design Details:</strong> {product.designDetails || "—"}</p>
            <p><strong>Notes:</strong> {product.notes || "—"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
