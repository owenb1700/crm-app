"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../../../lib/firebase";
import { doc, getDoc, getDocs, collection } from "firebase/firestore";
import { primaryEmail, primaryPhone, OWNER_CATEGORY } from "../../../lib/directory";
import { equipmentRowsFrom } from "../../../lib/equipment";
import DashboardHeader from "../../components/DashboardHeader";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

const matches = (q, fields) => fields.some(f => (f || "").toLowerCase().includes(q));

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [uid, setUid] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const [query, setQuery] = useState(searchParams.get("q") || "");

  const [customers, setCustomers] = useState([]);
  const [pipelineEntries, setPipelineEntries] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  const [towerModels, setTowerModels] = useState([]);

  const loadAll = async () => {
    const [customersSnap, pipelineSnap, companiesSnap, contactsSnap, productsSnap, towerModelsSnap] = await Promise.all([
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "pipeline")),
      getDocs(collection(db, "companies")),
      getDocs(collection(db, "contacts")),
      getDocs(collection(db, "products")),
      getDocs(collection(db, "towerModels"))
    ]);
    setCustomers(customersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setPipelineEntries(pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setProducts(productsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setTowerModels(towerModelsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
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
        setLoadError(err.message || "Something went wrong loading search results.");
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setQuery(searchParams.get("q") || "");
  }, [searchParams]);

  const runSearch = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/dashboard/search?q=${encodeURIComponent(query.trim())}`);
  };

  const q = (searchParams.get("q") || "").trim().toLowerCase();

  // Towers aren't their own collection -- same derive-by-serial-number
  // logic as the Towers directory page (every equipment row, not just the
  // first), so a serial number search here lands on the same tower record
  // that page would show.
  const towersBySerial = {};
  [...customers, ...pipelineEntries].forEach(entry => {
    equipmentRowsFrom(entry).forEach(row => {
      const serial = (row.serial || "").trim();
      if (!serial) return;
      const key = serial.toLowerCase();
      if (!towersBySerial[key]) {
        towersBySerial[key] = { serial, manufacturer: "", model: "", address: "" };
      }
      const t = towersBySerial[key];
      if (!t.manufacturer && row.manufacturer) t.manufacturer = row.manufacturer;
      if (!t.model && row.model) t.model = row.model;
      if (!t.address && entry.projectAddress) t.address = entry.projectAddress;
    });
  });

  const equipmentFields = (record) => equipmentRowsFrom(record).flatMap(r => [r.type, r.manufacturer, r.model, r.serial, r.yearInstalled]);

  const projectResults = q ? customers.filter(c => matches(q, [
    c.projectName, c.company, c.contact, c.email, c.phone, c.projectAddress, ...equipmentFields(c),
    ...(c.owners || []).flatMap(o => [o.company, o.contact])
  ])) : [];

  const pipelineResults = q ? pipelineEntries.filter(p => matches(q, [
    p.title, p.company, p.contact, p.email, p.phone, p.projectAddress, ...equipmentFields(p),
    ...(p.biddingCompanies || []).flatMap(b => [b.company, b.contact])
  ])) : [];

  const contractorResults = q ? companies.filter(c => c.category === "Contractor" && matches(q, [c.name, c.phone, c.address, c.website, c.notes])) : [];
  const engineeringResults = q ? companies.filter(c => c.category === "Engineering Firm" && matches(q, [c.name, c.phone, c.address, c.website, c.notes])) : [];
  const ownerResults = q ? companies.filter(c => c.category === OWNER_CATEGORY && matches(q, [c.name, c.phone, c.address, c.website, c.notes])) : [];
  const otherCompanyResults = q ? companies.filter(c => c.category !== "Contractor" && c.category !== "Engineering Firm" && c.category !== OWNER_CATEGORY && matches(q, [c.name, c.phone, c.address, c.website, c.notes])) : [];

  const peopleResults = q ? contacts.filter(p => matches(q, [
    p.name, p.title, p.notes, p.companyName,
    ...(p.emails || (p.email ? [p.email] : [])),
    ...(p.phones || (p.phone ? [p.phone] : []))
  ])) : [];

  const towerResults = q ? Object.values(towersBySerial).filter(t => matches(q, [t.serial, t.manufacturer, t.model, t.address])) : [];
  const towerModelResults = q ? towerModels.filter(m => matches(q, [m.manufacturer, m.model])) : [];
  const productResults = q ? products.filter(p => matches(q, [p.name, p.type, p.manufacturer, p.model, p.notes])) : [];

  const totalResults = projectResults.length + pipelineResults.length + contractorResults.length +
    engineeringResults.length + ownerResults.length + otherCompanyResults.length + peopleResults.length +
    towerResults.length + towerModelResults.length + productResults.length;

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load search results</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <div className="dashboard-page">Loading...</div>;
  }

  const Section = ({ title, items, render }) => items.length === 0 ? null : (
    <div className="project-section">
      <h4 className="field-label">{title} ({items.length})</h4>
      {items.map(render)}
    </div>
  );

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Search</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>← Back to Dashboard</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <form className="toolbar" onSubmit={runSearch}>
        <input
          className="field"
          placeholder="Search projects, pipeline, contractors, engineering firms, owners, people, towers, products..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ flex: 1, marginBottom: 0 }}
          autoFocus
        />
        <button className="btn btn-primary" type="submit">Search</button>
      </form>

      {!q && <p className="private-note-hint">Type something above and hit search.</p>}
      {q && totalResults === 0 && <p className="private-note-hint">No results for "{searchParams.get("q")}".</p>}

      <Section
        title="Projects"
        items={projectResults}
        render={c => (
          <div key={c.id} className="customer-card" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/project/${c.id}`)}>
            <div className="customer-card-left">
              <div className="customer-name">{c.projectName || c.company}</div>
              <div className="private-note-hint">{c.company}{c.contact ? ` — ${c.contact}` : ""}</div>
            </div>
            <div className="customer-card-middle">
              {c.projectAddress && <div className="private-note-hint">{c.projectAddress}</div>}
            </div>
          </div>
        )}
      />

      <Section
        title="Pipeline"
        items={pipelineResults}
        render={p => (
          <div key={p.id} className="customer-card" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/pipeline/${p.id}`)}>
            <div className="customer-card-left">
              <div className="customer-name">{p.title}</div>
              <div className="private-note-hint">{p.company}{p.contact ? ` — ${p.contact}` : ""}</div>
            </div>
            <div className="customer-card-middle">
              {p.stage && <span className="role-badge role-badge-admin">{p.stage}</span>}
            </div>
          </div>
        )}
      />

      <Section
        title="Contractors"
        items={contractorResults}
        render={c => (
          <div key={c.id} className="customer-card" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/directory/company/${c.id}`)}>
            <div className="customer-card-left">
              <div className="customer-name">{c.name}</div>
              <span className="role-badge role-badge-admin" style={{ marginTop: 6 }}>{c.category}</span>
            </div>
          </div>
        )}
      />

      <Section
        title="Engineering Firms"
        items={engineeringResults}
        render={c => (
          <div key={c.id} className="customer-card" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/directory/company/${c.id}`)}>
            <div className="customer-card-left">
              <div className="customer-name">{c.name}</div>
              <span className="role-badge role-badge-admin" style={{ marginTop: 6 }}>{c.category}</span>
            </div>
          </div>
        )}
      />

      <Section
        title="Owners & Building Engineers"
        items={ownerResults}
        render={c => (
          <div key={c.id} className="customer-card" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/directory/company/${c.id}`)}>
            <div className="customer-card-left">
              <div className="customer-name">{c.name}</div>
              <span className="role-badge role-badge-admin" style={{ marginTop: 6 }}>{c.category}</span>
            </div>
          </div>
        )}
      />

      <Section
        title="Other Companies"
        items={otherCompanyResults}
        render={c => (
          <div key={c.id} className="customer-card" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/directory/company/${c.id}`)}>
            <div className="customer-card-left">
              <div className="customer-name">{c.name}</div>
              <span className="role-badge role-badge-admin" style={{ marginTop: 6 }}>{c.category}</span>
            </div>
          </div>
        )}
      />

      <Section
        title="People"
        items={peopleResults}
        render={p => (
          <div key={p.id} className="customer-card" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/directory/company/${p.companyId}`)}>
            <div className="customer-card-left">
              <div className="customer-name">{p.name}</div>
              <div className="private-note-hint">{p.title ? `${p.title} — ` : ""}{p.companyName}</div>
            </div>
            <div className="customer-card-middle">
              {primaryEmail(p) && <div className="private-note-hint">{primaryEmail(p)}</div>}
              {primaryPhone(p) && <div className="private-note-hint">{primaryPhone(p)}</div>}
            </div>
          </div>
        )}
      />

      <Section
        title="Towers"
        items={towerResults}
        render={t => (
          <div key={t.serial} className="customer-card" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/directory/tower/${encodeURIComponent(t.serial)}`)}>
            <div className="customer-card-left">
              <div className="customer-name">{t.serial}</div>
              <div className="private-note-hint">{[t.manufacturer, t.model].filter(Boolean).join(" ")}</div>
            </div>
            <div className="customer-card-middle">
              {t.address && <div className="private-note-hint">{t.address}</div>}
            </div>
          </div>
        )}
      />

      <Section
        title="Tower Models"
        items={towerModelResults}
        render={m => (
          <div key={m.id} className="customer-card" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/directory/tower-model/${m.id}`)}>
            <div className="customer-card-left">
              <div className="customer-name">{m.manufacturer} {m.model}</div>
            </div>
          </div>
        )}
      />

      <Section
        title="Products"
        items={productResults}
        render={p => (
          <div key={p.id} className="customer-card" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/directory/product/${p.id}`)}>
            <div className="customer-card-left">
              <div className="customer-name">{p.name}</div>
              <div className="private-note-hint">{p.type}{p.manufacturer ? ` — ${p.manufacturer}` : ""}</div>
            </div>
          </div>
        )}
      />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="dashboard-page">Loading...</div>}>
      <SearchPageContent />
    </Suspense>
  );
}
