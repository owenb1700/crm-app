"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../../../../lib/firebase";
import { addDoc, collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { ensureCompanyAndContactBatch, primaryEmail, primaryPhone, firmTypeOf } from "../../../../lib/directory";
import FirmTypeSelect from "../../../components/FirmTypeSelect";
import BuildingSectorSelect from "../../../components/BuildingSectorSelect";
import { ensureTowerModel } from "../../../../lib/towerModels";
import AddressAutocomplete from "../../../components/AddressAutocomplete";
import SearchableSelect from "../../../components/SearchableSelect";
import DashboardHeader from "../../../components/DashboardHeader";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const PIPELINE_STAGE_OPTIONS = ["Pre-Bid", "Bidding", "Post-Bid", "Design", "Budgeting"];
const BLANK_BIDDER_ROW = { category: "Contractor", company: "", contact: "", email: "", phone: "" };
const BLANK_EQUIPMENT_ROW = { manufacturer: "", model: "" };

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

export default function NewPipelineEntry() {
  const router = useRouter();

  const [uid, setUid] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [towerModels, setTowerModels] = useState([]);
  const [products, setProducts] = useState([]);

  const [title, setTitle] = useState("");
  const [stage, setStage] = useState("Pre-Bid");
  const [buildingSector, setBuildingSector] = useState("");
  const [bidDate, setBidDate] = useState("");
  const [value, setValue] = useState("");
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [biddingCompanies, setBiddingCompanies] = useState([]);
  const [salespersonId, setSalespersonId] = useState("");
  const [projectPointPersonId, setProjectPointPersonId] = useState("");
  const [equipmentRows, setEquipmentRows] = useState([{ ...BLANK_EQUIPMENT_ROW }]);
  const [notes, setNotes] = useState("");

  const engineeringFirmOptions = companies.filter(c => c.category === "Engineering Firm").map(c => c.name);
  const firmOptions = (type) => companies.filter(c => c.category === firmTypeOf(type)).map(c => c.name);
  const contactsForCompany = (name) => contacts.filter(
    c => (c.companyName || "").toLowerCase() === (name || "").toLowerCase()
  );

  // Sourced from the actual Products directory, not a fixed list -- this
  // is equipment a real sale would draw from, unlike Add Project's Type
  // of Equipment dropdown (which is just the PRODUCT_TYPES categories).
  const manufacturerOptions = Array.from(new Set(products.map(p => p.manufacturer).filter(Boolean))).sort();
  const modelOptionsFor = (manufacturer) => Array.from(new Set(
    products
      .filter(p => (p.manufacturer || "").toLowerCase() === (manufacturer || "").toLowerCase())
      .map(p => p.model)
      .filter(Boolean)
  )).sort();

  const handleContactChange = (value) => {
    setContact(value);
    const match = contactsForCompany(company).find(c => c.name.toLowerCase() === value.toLowerCase());
    if (match) {
      setEmail(primaryEmail(match));
      setPhone(primaryPhone(match));
    }
  };

  const addBiddingCompanyRow = () => {
    setBiddingCompanies(prev => [...prev, { ...BLANK_BIDDER_ROW }]);
  };

  const updateBiddingCompanyRow = (index, field, value) => {
    setBiddingCompanies(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const handleBiddingContactChange = (index, value) => {
    updateBiddingCompanyRow(index, "contact", value);
    const row = biddingCompanies[index];
    const match = contactsForCompany(row.company).find(c => c.name.toLowerCase() === value.toLowerCase());
    if (match) {
      updateBiddingCompanyRow(index, "email", primaryEmail(match));
      updateBiddingCompanyRow(index, "phone", primaryPhone(match));
    }
  };

  const removeBiddingCompanyRow = (index) => {
    setBiddingCompanies(prev => prev.filter((_, i) => i !== index));
  };

  const addEquipmentRow = () => {
    setEquipmentRows(prev => [...prev, { ...BLANK_EQUIPMENT_ROW }]);
  };

  const updateEquipmentRow = (index, field, value) => {
    setEquipmentRows(prev => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const removeEquipmentRow = (index) => {
    setEquipmentRows(prev => prev.filter((_, i) => i !== index));
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

        const [usersSnap, companiesSnap, contactsSnap, towerModelsSnap, productsSnap] = await Promise.all([
          getDocs(collection(db, "users")),
          getDocs(collection(db, "companies")),
          getDocs(collection(db, "contacts")),
          getDocs(collection(db, "towerModels")),
          getDocs(collection(db, "products"))
        ]);
        setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setTowerModels(towerModelsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setProducts(productsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoaded(true);
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading this page.");
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // This screen shouldn't be left except via Cancel or Add Entry -- see the matching guard on the Add Project page for why
  // beforeunload/popstate are the only events that need catching.
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    window.history.pushState(null, "", window.location.href);

    const handlePopState = () => {
      if (window.confirm("Leave without finishing this pipeline entry? Use Cancel or Add Entry instead.")) {
        window.removeEventListener("beforeunload", handleBeforeUnload);
        router.back();
      } else {
        window.history.pushState(null, "", window.location.href);
      }
    };
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [router]);

  const handleCancel = () => {
    router.push("/dashboard#pipeline");
  };

  const addPipelineEntry = async () => {
    if (!title) {
      return alert("Please enter a project/opportunity name");
    }
    if (!buildingSector) {
      return alert("Please select a building sector");
    }

    setSaving(true);
    try {
      const cleanBidders = biddingCompanies.filter(r => r.company || r.contact);
      const equipment = equipmentRows.filter(r => r.manufacturer || r.model);
      const firstEquipment = equipment[0] || {};

      const ref = await addDoc(collection(db, "pipeline"), {
        title,
        stage,
        buildingSector,
        bidDate: bidDate || null,
        value: value || null,
        company: company || null,
        contact: contact || null,
        email: email || null,
        phone: phone || null,
        projectAddress: projectAddress || null,
        biddingCompanies: cleanBidders,
        equipment,
        towerManufacturer: firstEquipment.manufacturer || null,
        modelNumber: firstEquipment.model || null,
        salespersonId: salespersonId || null,
        projectPointPersonId: projectPointPersonId || null,
        trackedByIds: [],
        outcome: null,
        wonByContractor: null,
        nextCheckIn: null,
        ownerId: uid,
        convertedToProjectId: null,
        createdAt: new Date().toISOString()
      });

      await setDoc(doc(db, "pipeline", ref.id, "private", "data"), {
        notes,
        notesHistory: [],
        files: []
      });

      const captureEntries = [
        { companyName: company, category: "Engineering Firm", contactName: contact, email, phone },
        ...cleanBidders.map(r => ({ companyName: r.company, category: firmTypeOf(r.category), contactName: r.contact, email: r.email, phone: r.phone }))
      ];
      await ensureCompanyAndContactBatch(captureEntries, { companies, contacts, uid });
      await Promise.all(
        equipment.map(row => ensureTowerModel({ towerModels, manufacturer: row.manufacturer, model: row.model, uid }))
      );

      router.push(`/dashboard/pipeline/${ref.id}`);
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load this page</h3>
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
      <div className="dashboard-header is-sticky">
        <div className="dashboard-brand">
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Add Pipeline Entry</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-on-dark" onClick={handleCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={addPipelineEntry}>
            {saving ? "Adding…" : "Add Entry"}
          </button>
          <span className="header-divider" aria-hidden="true" />
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <div className="project-section">
          <input className="field" autoComplete="off" placeholder="Project / Opportunity Name" value={title} onChange={e => setTitle(e.target.value)} />

          <div className="form-grid-2">
            <BuildingSectorSelect id="new-pipeline-sector" value={buildingSector} onChange={setBuildingSector} />
            <div>
              <label className="field-label">Stage</label>
              <select className="field" value={stage} onChange={e => setStage(e.target.value)}>
                {PIPELINE_STAGE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Bid Date</label>
              <input className="field" type="date" value={bidDate} onChange={e => setBidDate(e.target.value)} />
            </div>

            <div>
              <label className="field-label">Estimated Value</label>
              <input className="field" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} />
            </div>

            <div>
              <label className="field-label">Engineering Firm</label>
              <SearchableSelect
                options={engineeringFirmOptions}
                value={company}
                onChange={setCompany}
                placeholder="Select or search engineering firm..."
                newLabel="engineering firm"
              />
            </div>
            <div>
              <label className="field-label">Contact</label>
              <SearchableSelect
                options={contactsForCompany(company).map(c => c.name)}
                value={contact}
                onChange={handleContactChange}
                placeholder="Select or search contact..."
                newLabel="contact"
              />
            </div>
            <div>
              <label className="field-label">Email</label>
              <input className="field" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Phone</label>
              <input className="field" autoComplete="off" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>

            <div>
              <label className="field-label">Project Address</label>
              <AddressAutocomplete value={projectAddress} onChange={setProjectAddress} />
            </div>
          </div>
        </div>

        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>Contractors & Owners Bidding (optional)</h4>
          {biddingCompanies.map((row, i) => (
            <div key={i} className="bidding-company-row with-type">
              <FirmTypeSelect id={`new-pipeline-bidder-type-${i}`} value={firmTypeOf(row.category)} onChange={v => updateBiddingCompanyRow(i, "category", v)} />
              <div>
                <label className="field-label">{firmTypeOf(row.category)}</label>
                <SearchableSelect
                  options={firmOptions(row.category)}
                  value={row.company}
                  onChange={v => updateBiddingCompanyRow(i, "company", v)}
                  placeholder={`Select or search ${firmTypeOf(row.category).toLowerCase()}...`}
                  newLabel={firmTypeOf(row.category).toLowerCase()}
                />
              </div>
              <div>
                <label className="field-label">Contact</label>
                <SearchableSelect
                  options={contactsForCompany(row.company).map(c => c.name)}
                  value={row.contact}
                  onChange={v => handleBiddingContactChange(i, v)}
                  placeholder="Select or search contact..."
                  newLabel="contact"
                />
              </div>
              <div>
                <label className="field-label">Email</label>
                <input className="field" autoComplete="off" value={row.email} onChange={e => updateBiddingCompanyRow(i, "email", e.target.value)} />
              </div>
              <div>
                <label className="field-label">Phone</label>
                <input className="field" autoComplete="off" value={row.phone} onChange={e => updateBiddingCompanyRow(i, "phone", e.target.value)} />
              </div>
              <button className="btn btn-danger" onClick={() => removeBiddingCompanyRow(i)}>Remove</button>
            </div>
          ))}
          <button className="btn btn-secondary" onClick={addBiddingCompanyRow}>+ Add Bidder</button>
        </div>

        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>Assigned Team (optional)</h4>
          <div className="form-grid-2">
            <div>
              <label className="field-label">Salesperson</label>
              <select className="field" value={salespersonId} onChange={e => setSalespersonId(e.target.value)}>
                <option value="">Unassigned</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Project Point Person</label>
              <select className="field" value={projectPointPersonId} onChange={e => setProjectPointPersonId(e.target.value)}>
                <option value="">Unassigned</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>Equipment Details (optional)</h4>
          {equipmentRows.map((row, i) => (
            <div
              key={i}
              className="equipment-row equipment-row-2"
            >
              <SearchableSelect
                options={manufacturerOptions}
                value={row.manufacturer}
                onChange={v => updateEquipmentRow(i, "manufacturer", v)}
                placeholder="Select or search manufacturer..."
                newLabel="manufacturer"
              />
              <SearchableSelect
                options={modelOptionsFor(row.manufacturer)}
                value={row.model}
                onChange={v => updateEquipmentRow(i, "model", v)}
                placeholder="Select or search model..."
                newLabel="model"
              />
              <button className="btn btn-danger" onClick={() => removeEquipmentRow(i)}>Remove</button>
            </div>
          ))}
          <button className="btn btn-secondary" onClick={addEquipmentRow}>+ Add Equipment</button>
        </div>

        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>Notes</h4>
          <input className="field" autoComplete="off" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>

    </div>
  );
}
