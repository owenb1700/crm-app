"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../../../../lib/firebase";
import { addDoc, collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { ensureCompanyAndContactBatch, primaryEmail, primaryPhone, OWNER_CATEGORY, BLANK_OWNER_ROW, cleanOwnerRows } from "../../../../lib/directory";
import FirmTypeSelect from "../../../components/FirmTypeSelect";
import BuildingSectorSelect from "../../../components/BuildingSectorSelect";
import WorkTypeSelect from "../../../components/WorkTypeSelect";
import { ensureTowerModel } from "../../../../lib/towerModels";
import { PRODUCT_TYPES, PRODUCT_MANUFACTURERS } from "../../../../lib/products";
import AddressAutocomplete from "../../../components/AddressAutocomplete";
import DashboardHeader from "../../../components/DashboardHeader";
import MoneyInput from "../../../components/MoneyInput";
import MobileNav from "../../../components/MobileNav";
import { FirmSelect, PersonSelect, peopleAtFirm, findPerson } from "../../../components/DirectoryPickers";
import CreditSplitEditor from "../../../components/CreditSplitEditor";
import SalespersonSelect from "../../../components/SalespersonSelect";
import { canEnterForOthers } from "../../../../lib/permissions";
import { notifyUsers, newSplitMembers } from "../../../../lib/notify";
import { normalizeSplits, splitError, withSplitMembers } from "../../../../lib/splits";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
// Parts moved to their own tab (/dashboard/parts), so they're no longer
// a project status. Projects filed as Parts before the move keep the
// label until someone changes it.
const CATEGORY_OPTIONS = ["Pre-Bid", "Bidding", "Prospecting", "Ongoing Project", "Order", "Project Closed"];
const BLANK_EQUIPMENT_ROW = { type: "", manufacturer: "", model: "", serial: "", yearInstalled: "" };

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

// A project can have several pieces of equipment on file; only the first
// one is mirrored into the legacy single-equipment fields
// (equipmentType/towerManufacturer/modelNumber/serialNumber/dateInstalled)
// that the project edit form, Towers list, tower-by-serial lookup, and
// search still read -- those haven't been reworked to show more than one
// yet, so equipment #2+ is saved but only visible via the `equipment` array.
export default function NewProject() {
  const router = useRouter();

  const [uid, setUid] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [towerModels, setTowerModels] = useState([]);
  // Who a credit split can name.
  const [users, setUsers] = useState([]);
  const [myProfile, setMyProfile] = useState(null);
  // Blank means "mine". Only shown to people who may enter for others.
  const [salespersonId, setSalespersonId] = useState("");

  const myName = () => {
    const me = users.find(u => u.id === uid) || myProfile;
    if (!me) return "a teammate";
    return me.firstName && me.lastName ? `${me.firstName} ${me.lastName}` : (me.email || "a teammate");
  };

  const [projectName, setProjectName] = useState("");
  const [company, setCompany] = useState("");
  const [companyCategory, setCompanyCategory] = useState("Contractor");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState("");
  const [buildingSector, setBuildingSector] = useState("");
  const [projectValue, setProjectValue] = useState("");
  const [workType, setWorkType] = useState("");
  const [splits, setSplits] = useState([]);
  const [nextDate, setNextDate] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [equipmentRows, setEquipmentRows] = useState([{ ...BLANK_EQUIPMENT_ROW }]);
  const [ownerRows, setOwnerRows] = useState([]);

  const contactsForCompany = (name) => peopleAtFirm(contacts, name, companies);
  const matchingContacts = contactsForCompany(company);

  const updateOwnerRow = (index, field, value) => {
    setOwnerRows(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const handleOwnerContactChange = (index, value) => {
    const match = findPerson(contactsForCompany(ownerRows[index].company), value);
    setOwnerRows(prev => prev.map((row, i) => (i === index
      ? { ...row, contact: value, ...(match && { email: primaryEmail(match), phone: primaryPhone(match) }) }
      : row)));
  };

  const handleContactChange = (value) => {
    setContact(value);
    const match = findPerson(matchingContacts, value);
    if (match) {
      setEmail(primaryEmail(match));
      setPhone(primaryPhone(match));
    }
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
        setMyProfile(profileSnap.data());
        if (profileSnap.data().disabled) {
          clearSession();
          await signOut(auth);
          router.push("/");
          return;
        }

        const [companiesSnap, contactsSnap, towerModelsSnap, usersSnap] = await Promise.all([
          getDocs(collection(db, "companies")),
          getDocs(collection(db, "contacts")),
          getDocs(collection(db, "towerModels")),
          getDocs(collection(db, "users"))
        ]);
        setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setTowerModels(towerModelsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
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

  // This screen shouldn't be left except via Cancel or Add Project. Neither of those triggers beforeunload/popstate (they're plain
  // client-side router.push calls, not real navigation/unload events) --
  // this guard only has to catch the other ways out: closing the tab,
  // refreshing, typing a new address, or the browser back/forward buttons.
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // An extra history entry means a back-button press lands here first
    // (firing popstate) instead of immediately leaving, so we get a
    // chance to confirm before actually navigating away.
    window.history.pushState(null, "", window.location.href);

    const handlePopState = () => {
      if (window.confirm("Leave without finishing this project? Use Cancel or Add Project instead.")) {
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
    router.push("/dashboard#personal");
  };

  const addProject = async () => {
    const missing = [];
    if (!projectName) missing.push("Project Name");
    if (!buildingSector) missing.push("Building Sector");
    if (!workType) missing.push("Work Type");
    if (!contact) missing.push("Contact");
    if (!nextDate) missing.push("Next Date");
    if (!projectAddress) missing.push("Project Address");
    if (missing.length) {
      return alert(`Please fill in the following required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
    }
    const splitProblem = splitError(splits);
    if (splitProblem) {
      return alert(splitProblem);
    }

    setSaving(true);
    try {
      const equipment = equipmentRows.filter(r => r.type || r.manufacturer || r.model || r.serial || r.yearInstalled);
      const first = equipment[0] || {};
      const owners = cleanOwnerRows(ownerRows);
      // Filed for someone else only when that's allowed and someone else
      // was actually picked.
      const ownerId = (canEnterForOthers(myProfile) && salespersonId) ? salespersonId : uid;
      const enteredForSomeoneElse = ownerId !== uid;

      const ref = await addDoc(collection(db, "customers"), {
        projectName,
        company,
        companyCategory,
        contact,
        email,
        phone,
        owners,
        category: category || null,
        buildingSector,
        projectValue: projectValue || null,
        workType,
        equipment,
        equipmentType: first.type || null,
        towerManufacturer: first.manufacturer || null,
        modelNumber: first.model || null,
        serialNumber: first.serial || null,
        dateInstalled: first.yearInstalled || null,
        projectAddress: projectAddress || null,
        nextCheckIn: nextDate,
        lastContact: new Date().toISOString().split("T")[0],
        activityLog: enteredForSomeoneElse
          ? [{ type: "entered", outcome: `Entered by ${myName()}`, notes: null, timestamp: new Date().toISOString() }]
          : [],
        ownerId,
        enteredBy: ownerId === uid ? null : uid,
        splits: normalizeSplits(splits),
        // Everyone on the split works the project, like a collaborator --
        // and so does whoever entered it for someone else, which is what
        // makes this behave like a collaboration they didn't have to ask
        // for.
        collaboratorIds: withSplitMembers(ownerId === uid ? [] : [uid], splits, ownerId),
        createdAt: new Date().toISOString()
      });

      await setDoc(doc(db, "customers", ref.id, "private", "data"), {
        notes,
        notesHistory: []
      });

      await ensureCompanyAndContactBatch([
        { companyName: company, category: companyCategory, contactName: contact, email, phone },
        ...owners.map(r => ({ companyName: r.company, category: OWNER_CATEGORY, contactName: r.contact, email: r.email, phone: r.phone }))
      ], { companies, contacts, uid });

      await Promise.all(
        equipment
          .filter(row => row.manufacturer || row.model)
          .map(row => ensureTowerModel({ towerModels, manufacturer: row.manufacturer, model: row.model, uid }))
      );

      await notifyUsers(
        newSplitMembers(null, { splits }).filter(id => id !== uid && id !== ownerId),
        { type: "split_share", message: `You were given a share of "${projectName}"`, link: `/dashboard/project/${ref.id}` }
      );

      // Tell the salesperson it's theirs -- otherwise it just appears in
      // their list one day with no explanation.
      if (enteredForSomeoneElse) {
        await addDoc(collection(db, "notifications"), {
          userId: ownerId,
          type: "assigned",
          message: `${myName()} added the project "${projectName}" for you`,
          link: `/dashboard/project/${ref.id}`,
          read: false,
          createdAt: new Date().toISOString()
        }).catch(() => {});
      }

      router.push(`/dashboard/project/${ref.id}`);
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
      <div className="dashboard-header is-sticky">
        <div className="dashboard-brand">
          <MobileNav uid={uid} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Add Project</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-on-dark" onClick={handleCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={addProject}>
            {saving ? "Adding…" : "Add Project"}
          </button>
          <span className="header-divider" aria-hidden="true" />
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <div className="project-section">
          <input className="field" autoComplete="off" placeholder="Project Name" value={projectName} onChange={e => setProjectName(e.target.value)} />

          <FirmTypeSelect id="new-project-company-type" value={companyCategory} onChange={setCompanyCategory} />

          <div>
            <label className="field-label">{companyCategory}</label>
            <FirmSelect id="new-project-company" companies={companies} category={companyCategory} value={company} onChange={setCompany} />
          </div>

          <div>
            <label className="field-label">Contact</label>
            <PersonSelect id="new-project-contact" people={matchingContacts} value={contact} onChange={handleContactChange} />
          </div>

          <div>
            <label className="field-label">Email</label>
            <input className="field" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Phone</label>
            <input className="field" autoComplete="off" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>

          <BuildingSectorSelect id="new-project-sector" value={buildingSector} onChange={setBuildingSector} />

          <select className="field" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">Select category...</option>
            {CATEGORY_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>

          <div>
            <label className="field-label" htmlFor="new-project-value">Project Value</label>
            <MoneyInput id="new-project-value" value={projectValue} onChange={setProjectValue} />
          </div>
          <WorkTypeSelect id="new-project-work-type" value={workType} onChange={setWorkType} />

          {canEnterForOthers(myProfile) && (
            <SalespersonSelect
              id="new-project-salesperson"
              label="Salesperson if entering for someone else (whose project is this?)"
              users={users.filter(u => !u.disabled && u.role !== "estimating")}
              value={salespersonId || uid || ""}
              onChange={setSalespersonId}
            />
          )}

          <div style={{ gridColumn: "1 / -1" }}>
            <label className="field-label">Credit Split (optional)</label>
            <CreditSplitEditor idPrefix="new-project-split" users={users} value={splits} onChange={setSplits} ownerId={uid} ownerLabel="you" />
          </div>

          <div>
            <label className="field-label">Next Date</label>
            <input className="field" type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} />
          </div>

          <div>
            <label className="field-label">Project Address</label>
            <AddressAutocomplete placeholder="Project Address (required)" value={projectAddress} onChange={setProjectAddress} />
          </div>

          <input className="field" autoComplete="off" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>Owners & Building Engineers (optional)</h4>
          {ownerRows.map((row, i) => (
            <div key={i} className="bidding-company-row">
              <div>
                <label className="field-label">Owner / Building Engineer</label>
                <FirmSelect
                  id={`new-project-owner-${i}`}
                  companies={companies}
                  category={OWNER_CATEGORY}
                  value={row.company}
                  onChange={v => updateOwnerRow(i, "company", v)}
                  placeholder="Select or search firm..."
                />
              </div>
              <div>
                <label className="field-label">Contact</label>
                <PersonSelect id={`new-project-owner-contact-${i}`} people={contactsForCompany(row.company)} value={row.contact} onChange={v => handleOwnerContactChange(i, v)} />
              </div>
              <div>
                <label className="field-label">Email</label>
                <input className="field" autoComplete="off" value={row.email} onChange={e => updateOwnerRow(i, "email", e.target.value)} />
              </div>
              <div>
                <label className="field-label">Phone</label>
                <input className="field" autoComplete="off" value={row.phone} onChange={e => updateOwnerRow(i, "phone", e.target.value)} />
              </div>
              <button className="btn btn-danger" onClick={() => setOwnerRows(prev => prev.filter((_, idx) => idx !== i))}>Remove</button>
            </div>
          ))}
          <button className="btn btn-secondary" onClick={() => setOwnerRows(prev => [...prev, { ...BLANK_OWNER_ROW }])}>+ Add Owner / Building Engineer</button>
        </div>

        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>Equipment & Site Details (optional)</h4>
          {equipmentRows.map((row, i) => (
            <div
              key={i}
              className="equipment-row"
            >
              <select
                className="field"
                style={{ marginBottom: 0 }}
                value={row.type}
                onChange={e => updateEquipmentRow(i, "type", e.target.value)}
              >
                <option value="">Type of Equipment...</option>
                {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input
                className="field"
                style={{ marginBottom: 0 }}
                list={`new-project-equipment-manufacturers-${i}`}
                autoComplete="off"
                placeholder="Tower Manufacturer"
                value={row.manufacturer}
                onChange={e => updateEquipmentRow(i, "manufacturer", e.target.value)}
              />
              <datalist id={`new-project-equipment-manufacturers-${i}`}>
                {PRODUCT_MANUFACTURERS.map(m => <option key={m} value={m} />)}
              </datalist>
              <input
                className="field"
                style={{ marginBottom: 0 }}
                autoComplete="off"
                placeholder="Model Number"
                value={row.model}
                onChange={e => updateEquipmentRow(i, "model", e.target.value)}
              />
              <input
                className="field"
                style={{ marginBottom: 0 }}
                autoComplete="off"
                placeholder="Serial Number"
                value={row.serial}
                onChange={e => updateEquipmentRow(i, "serial", e.target.value)}
              />
              <input
                className="field"
                style={{ marginBottom: 0 }}
                type="number"
                placeholder="Year Installed"
                min="1900"
                max="2100"
                value={row.yearInstalled}
                onChange={e => updateEquipmentRow(i, "yearInstalled", e.target.value)}
              />
              <button className="btn btn-danger" onClick={() => removeEquipmentRow(i)}>Remove</button>
            </div>
          ))}
          <button className="btn btn-secondary" onClick={addEquipmentRow}>+ Add Equipment</button>
        </div>
      </div>

    </div>
  );
}
