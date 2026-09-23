"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../../../../lib/firebase";
import { addDoc, collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { notifyUsers, firmOwnersFor, firmsOnEntry, newSplitMembers } from "../../../../lib/notify";
import { firmsNeedingDetails } from "../../../../lib/newFirms";
import { saveFirmTags } from "../../../../lib/firmTypes";
import FirmDetailsPrompt from "../../../components/FirmDetailsPrompt";
import { ensureCompanyAndContactBatch, primaryEmail, primaryPhone, firmTypeOf, salespersonAfterFirmChange } from "../../../../lib/directory";
import BuildingSectorSelect from "../../../components/BuildingSectorSelect";
import WorkTypeSelect from "../../../components/WorkTypeSelect";
import BidderEditor from "../../../components/BidderEditor";
import { biddersForStorage, bidderDirectoryEntries, bidderMissingSalesperson } from "../../../../lib/bidders";
import { ensureTowerModel } from "../../../../lib/towerModels";
import AddressAutocomplete from "../../../components/AddressAutocomplete";
import ProductOptionsEditor from "../../../components/ProductOptionsEditor";
import { blankProductRow, productRowsForStorage, isTowerRow } from "../../../../lib/equipment";
import DashboardHeader from "../../../components/DashboardHeader";
import MoneyInput from "../../../components/MoneyInput";
import MobileNav from "../../../components/MobileNav";
import { FirmSelect, PersonSelect, peopleAtFirm, findPerson } from "../../../components/DirectoryPickers";
import CreditSplitEditor from "../../../components/CreditSplitEditor";
import { normalizeSplits, splitError, withSplitMembers } from "../../../../lib/splits";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const PIPELINE_STAGE_OPTIONS = ["Pre-Bid", "Bidding", "Post-Bid", "Design", "Budgeting"];

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

export default function NewPipelineEntry() {
  const router = useRouter();

  const [uid, setUid] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [firmQueue, setFirmQueue] = useState(null);

  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [towerModels, setTowerModels] = useState([]);
  const [products, setProducts] = useState([]);

  const [title, setTitle] = useState("");
  const [stage, setStage] = useState("Pre-Bid");
  const [buildingSector, setBuildingSector] = useState("");
  const [workType, setWorkType] = useState("");
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
  const [splits, setSplits] = useState([]);
  const [equipmentRows, setEquipmentRows] = useState([blankProductRow()]);
  const [notes, setNotes] = useState("");

  const contactsForCompany = (name) => peopleAtFirm(contacts, name, companies);

  const handleContactChange = (value) => {
    setContact(value);
    const match = findPerson(contactsForCompany(company), value);
    if (match) {
      setEmail(primaryEmail(match));
      setPhone(primaryPhone(match));
    }
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

  // The engineering firm and every bidder named on this form.
  const firmEntries = () => [
    { name: company, category: "Engineering Firm" },
    ...biddersForStorage(biddingCompanies).map(b => ({ name: b.company, category: firmTypeOf(b.category) }))
  ];

  const addPipelineEntry = async (choice = null) => {
    // Only the prompt's answer counts -- a click event is not one.
    const firmTags = choice && !choice.nativeEvent && typeof choice === "object" ? choice : null;
    if (!title) {
      return alert("Please enter a project/opportunity name");
    }
    if (!buildingSector) {
      return alert("Please select a building sector");
    }
    if (!workType) {
      return alert("Please select a work type (new installation, replacement, or repair)");
    }
    const splitProblem = splitError(splits);
    if (splitProblem) {
      return alert(splitProblem);
    }
    // Every bidder needs one of our salespeople assigned to it.
    const missingSalesperson = bidderMissingSalesperson(biddingCompanies);
    if (missingSalesperson) {
      return alert(`Select a salesperson for bidder "${missingSalesperson.company || "without a firm name"}"`);
    }

    const needDetails = firmTags ? [] : firmsNeedingDetails(firmEntries(), companies);
    if (needDetails.length) return setFirmQueue(needDetails);

    setSaving(true);
    try {
      // One row per firm, with all of that firm's people grouped under it.
      const cleanBidders = biddersForStorage(biddingCompanies);
      const equipment = productRowsForStorage(equipmentRows);
      const firstEquipment = equipment[0] || {};

      const ref = await addDoc(collection(db, "pipeline"), {
        title,
        stage,
        buildingSector,
        workType,
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
        splits: normalizeSplits(splits),
        // Everyone on the split works the entry, same as adding it to their dashboard.
        trackedByIds: withSplitMembers([], splits),
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
        ...bidderDirectoryEntries(cleanBidders, firmTypeOf)
      ];
      await ensureCompanyAndContactBatch(captureEntries, { companies, contacts, uid });

      // Tell the reps whose firms are on this entry, and anyone given a
      // share of it. A share already makes them a collaborator (see
      // withSplitMembers above); this is so they hear about it.
      const owners = firmOwnersFor(firmsOnEntry({ company, biddingCompanies: cleanBidders }), companies);
      await Promise.all([...owners.entries()]
        .filter(([personId]) => personId !== uid)
        .map(([personId, firmName]) => notifyUsers([personId], {
          type: "firm_on_entry",
          message: `${firmName} was added to the pipeline entry "${title}"`,
          link: `/dashboard/pipeline/${ref.id}`
        })));

      await notifyUsers(
        newSplitMembers(null, { splits }).filter(id => id !== uid),
        { type: "split_share", message: `You were given a share of "${title}"`, link: `/dashboard/pipeline/${ref.id}` }
      );
      await Promise.all(
        equipment.filter(isTowerRow).map(row => ensureTowerModel({ towerModels, manufacturer: row.manufacturer, model: row.model, uid }))
      );

      // Straight back to the Pipeline list (no stop on the new entry's own
      // page); the dashboard shows a short "added" message.
      try {
        sessionStorage.setItem("dashboardToast", `Pipeline entry "${title}" added`);
      } catch {
        // Storage unavailable -- the entry is still saved, just no message.
      }
      if (firmTags) {
        await Promise.all(Object.entries(firmTags).map(([name, tags]) => {
          const entry = firmEntries().find(f => f.name === name);
          return saveFirmTags(name, entry?.category, tags);
        }));
      }

      router.replace("/dashboard#pipeline");
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
          <h1 className="dashboard-title">Add Pipeline Entry</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-on-dark" onClick={handleCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={() => addPipelineEntry()}>
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
              <MoneyInput id="new-pipeline-value" value={value} onChange={setValue} />
            </div>
            <WorkTypeSelect id="new-pipeline-work-type" value={workType} onChange={setWorkType} />

            <div>
              <label className="field-label">Engineering Firm</label>
              <FirmSelect
                id="new-pipeline-firm"
                companies={companies}
                category="Engineering Firm"
                value={company}
                onChange={v => {
                  setSalespersonId(salespersonAfterFirmChange({ companies, users, previousFirm: company, nextFirm: v, currentSalespersonId: salespersonId }));
                  setCompany(v);
                }}
              />
            </div>
            <div>
              <label className="field-label">Contact</label>
              <PersonSelect id="new-pipeline-contact" people={contactsForCompany(company)} value={contact} onChange={handleContactChange} />
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

          <h4 className="field-label" style={{ marginTop: 16 }}>Credit Split (optional)</h4>
          <CreditSplitEditor idPrefix="new-pipeline-split" users={users} value={splits} onChange={setSplits} ownerId={salespersonId || uid} />
        </div>

        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>Contractors & Owners Bidding (optional)</h4>
          <BidderEditor
            idPrefix="new-pipeline-bidder"
            bidders={biddingCompanies}
            onChange={setBiddingCompanies}
            companies={companies}
            contacts={contacts}
            users={users}
          />
        </div>

        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>Product Options (optional)</h4>
          <ProductOptionsEditor idPrefix="new-pipeline-product" rows={equipmentRows} onChange={setEquipmentRows} products={products} />
        </div>

        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>Notes</h4>
          <input className="field" autoComplete="off" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>

      {firmQueue && (
        <FirmDetailsPrompt
          queue={firmQueue}
          busy={saving}
          onDone={(tags) => { setFirmQueue(null); addPipelineEntry(tags); }}
          onCancel={() => setFirmQueue(null)}
        />
      )}
    </div>
  );
}
