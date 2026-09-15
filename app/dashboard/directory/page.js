"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../../../lib/firebase";
import { doc, getDoc, getDocs, collection, addDoc } from "firebase/firestore";
import { COMPANY_CATEGORIES, CATEGORY_TITLES } from "../../../lib/directory";
import DashboardHeader from "../../components/DashboardHeader";
import AddressAutocomplete from "../../components/AddressAutocomplete";
import MobileNav from "../../components/MobileNav";
import { withoutTrashed } from "../../../lib/trash";
import { claimCompany } from "../../../lib/directory";
import { sameCompany, findSimilarCompanies, groupSimilarCompanies, groupSimilarPeople, groupIdOf } from "../../../lib/companyMatch";
import { companyConflicts, personConflicts } from "../../../lib/directoryConflicts";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

function DirectoryPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const categoryFilter = searchParams.get("category") || "all";

  const [uid, setUid] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [pipelineEntries, setPipelineEntries] = useState([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newAddress, setNewAddress] = useState("");
  // Adding a company from a filtered view defaults to that view's category.
  const [newCategory, setNewCategory] = useState(COMPANY_CATEGORIES.includes(categoryFilter) ? categoryFilter : "Contractor");
  const [addState, setAddState] = useState(null); // null | { same } | { similar: [...] } | { saving: true }
  const [isAdmin, setIsAdmin] = useState(false);
  const [dismissals, setDismissals] = useState([]);

  const loadAll = async () => {
    const [companiesSnap, contactsSnap, customersSnap, pipelineSnap, dismissalsSnap] = await Promise.all([
      getDocs(collection(db, "companies")),
      getDocs(collection(db, "contacts")),
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "pipeline")),
      getDocs(collection(db, "duplicateDismissals")).catch(() => ({ docs: [] }))
    ]);
    setDismissals(dismissalsSnap.docs.map(d => d.data().groupId));
    setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setCustomers(withoutTrashed(customersSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
    setPipelineEntries(withoutTrashed(pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
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

        setIsAdmin(profileSnap.data().role === "admin");
        await loadAll();
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading the directory.");
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jobCounts = (companyName) => {
    const projectCount = customers.filter(c =>
      sameCompany(c.company, companyName) ||
      (c.owners || []).some(o => sameCompany(o.company, companyName))
    ).length;
    const pipelineCount = pipelineEntries.filter(p =>
      sameCompany(p.company, companyName) ||
      (p.biddingCompanies || []).some(b => sameCompany(b.company, companyName))
    ).length;
    return { projectCount, pipelineCount };
  };

  const resetAdd = () => {
    setNewName("");
    setNewPhone("");
    setNewAddress("");
    setNewCategory(COMPANY_CATEGORIES.includes(categoryFilter) ? categoryFilter : "Contractor");
    setAddState(null);
    setShowAddModal(false);
  };

  // Adding a firm that's already on file (even spelled a bit differently)
  // points to the existing one; a merely similar name asks first.
  const addCompany = async (force = false) => {
    const name = newName.trim();
    if (!name) return alert("Enter a company name");
    const same = companies.find(c => sameCompany(c.name, name));
    if (same) return setAddState({ same });
    const similar = findSimilarCompanies(companies, name);
    if (similar.length && !force) return setAddState({ similar });

    setAddState({ saving: true });
    try {
      const created = await claimCompany({ name, category: newCategory, phone: newPhone.trim(), address: newAddress.trim(), uid });
      if (created.alreadyExisted) {
        await loadAll();
        return setAddState({ same: created });
      }
      resetAdd();
      loadAll();
    } catch (err) {
      setAddState(null);
      alert(`Couldn't add the company: ${err.message}`);
    }
  };

  // Likely duplicates still waiting for an admin to merge or dismiss.
  const duplicateCount = isAdmin
    ? groupSimilarCompanies(companies).filter(g => !dismissals.includes(groupIdOf(g))).length +
      groupSimilarPeople(contacts).filter(g => !dismissals.includes(groupIdOf(g))).length
    : 0;

  const needsReview = (company) =>
    companyConflicts(company).length > 0 || contacts.some(p => p.companyId === company.id && personConflicts(p).length > 0);

  // No search: plain alphabetical. Searching: rank by closeness of match --
  // name starts-with beats name contains beats a matching person at that
  // company -- so the best match always lands on top instead of just
  // wherever it falls alphabetically.
  const q = searchQuery.trim().toLowerCase();
  const byCategory = companies.filter(c => categoryFilter === "all" || c.category === categoryFilter);

  const results = q
    ? byCategory
        .map(c => {
          const nameLower = c.name.toLowerCase();
          const nameIdx = nameLower.indexOf(q);
          const matchedPerson = contacts.find(
            p => p.companyId === c.id && p.name.toLowerCase().includes(q)
          );
          let score = null;
          if (nameIdx === 0) score = 0;
          else if (nameIdx > 0) score = 1;
          else if (matchedPerson) score = 2;
          return { company: c, matchedPerson: score === 2 ? matchedPerson : null, score };
        })
        .filter(r => r.score !== null)
        .sort((a, b) => a.score - b.score || a.company.name.localeCompare(b.company.name))
    : byCategory
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => ({ company: c, matchedPerson: null }));

  const contactCount = (companyId) => contacts.filter(c => c.companyId === companyId).length;

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load the directory</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>Back to My Projects</button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <div className="dashboard-page">Loading...</div>;
  }

  const title = categoryFilter === "all" ? "All Companies" : (CATEGORY_TITLES[categoryFilter] || categoryFilter);

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Directory — {title}</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>← Back to My Projects</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="toolbar">
        <input
          className="field"
          placeholder="Search companies or people..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ flex: 1, marginBottom: 0 }}
        />
        {isAdmin && (
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory/duplicates")}>
            Find Duplicates{duplicateCount ? ` (${duplicateCount})` : ""}
          </button>
        )}
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Add Company</button>
      </div>

      {results.length === 0 && (
        <p className="private-note-hint">No companies found.</p>
      )}

      {results.map(({ company: c, matchedPerson }) => {
        const { projectCount, pipelineCount } = jobCounts(c.name);
        return (
          <div
            key={c.id}
            className="customer-card"
            onClick={() => router.push(`/dashboard/directory/company/${c.id}`)}
            style={{ cursor: "pointer" }}
          >
            <div className="customer-card-left">
              <div className="customer-name">{c.name}</div>
              <span className="role-badge role-badge-admin" style={{ marginTop: 6 }}>{c.category}</span>
              {needsReview(c) && <span className="review-flag" title="Different information is on file -- confirm which is correct">⚠ Needs review</span>}
            </div>
            <div className="customer-card-middle">
              {matchedPerson && (
                <div className="private-note-hint">Matched: {matchedPerson.name}{matchedPerson.title ? ` (${matchedPerson.title})` : ""}</div>
              )}
              <div className="private-note-hint">{contactCount(c.id)} people</div>
              {categoryFilter === "all" && (
                <>
                  <div className="private-note-hint">{projectCount} project{projectCount === 1 ? "" : "s"}</div>
                  <div className="private-note-hint">{pipelineCount} pipeline entr{pipelineCount === 1 ? "y" : "ies"}</div>
                </>
              )}
            </div>
          </div>
        );
      })}

      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <button className="modal-close" onClick={resetAdd}>✕</button>
            <h3 className="modal-title">Add Company</h3>

            <label className="field-label" htmlFor="add-company-name">Name</label>
            <input id="add-company-name" className="field" autoComplete="off" value={newName} onChange={e => { setNewName(e.target.value); setAddState(null); }} />
            {addState?.same && (
              <div className="duplicate-warning">
                <strong>{addState.same.name}</strong> is already in the Directory{addState.same.category ? ` as ${addState.same.category}` : ""}.
                <div className="duplicate-warning-actions">
                  <button type="button" className="btn btn-primary" onClick={() => router.push(`/dashboard/directory/company/${addState.same.id}`)}>Open it</button>
                </div>
              </div>
            )}
            {addState?.similar && (
              <div className="duplicate-warning">
                Did you mean one of these? They&apos;re already in the Directory:
                <ul>
                  {addState.similar.map(c => (
                    <li key={c.id}>
                      <button type="button" className="link-muted matching-select-link" onClick={() => router.push(`/dashboard/directory/company/${c.id}`)}>{c.name}</button>
                      <span className="matching-select-tag">{c.category}</span>
                    </li>
                  ))}
                </ul>
                <div className="duplicate-warning-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => addCompany(true)}>No, add &quot;{newName.trim()}&quot; as a new company</button>
                </div>
              </div>
            )}

            <label className="field-label">Category</label>
            <select className="field" value={newCategory} onChange={e => setNewCategory(e.target.value)}>
              {COMPANY_CATEGORIES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>

            <label className="field-label" htmlFor="add-company-phone">Phone (optional)</label>
            <input id="add-company-phone" className="field" autoComplete="off" value={newPhone} onChange={e => setNewPhone(e.target.value)} />

            <label className="field-label" htmlFor="add-company-address">Address (optional)</label>
            <AddressAutocomplete id="add-company-address" name="add-company-address" placeholder="Company Address" value={newAddress} onChange={setNewAddress} />

            <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} disabled={!!addState?.saving} onClick={() => addCompany(false)}>
              {addState?.saving ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DirectoryPage() {
  return (
    <Suspense fallback={<div className="dashboard-page">Loading...</div>}>
      <DirectoryPageContent />
    </Suspense>
  );
}
