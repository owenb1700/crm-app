"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { auth, db } from "../../../../lib/firebase";
import { directoryAction } from "../../../../lib/directory";
import { groupIdOf, groupSimilarCompanies, groupSimilarPeople, sameCompany } from "../../../../lib/companyMatch";
import { emailsOf, phonesOf } from "../../../../lib/directoryConflicts";
import { withoutTrashed } from "../../../../lib/trash";
import DashboardHeader from "../../../components/DashboardHeader";
import MobileNav from "../../../components/MobileNav";
import ConfirmDialog from "../../../components/ConfirmDialog";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const formatPhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : phone;
};

// Admin-only: companies (and people at the same company) whose names look
// like the same one entered more than once. Nothing merges on its own --
// for each group an admin picks the record to keep and merges, or marks the
// group as not duplicates.
export default function FindDuplicates() {
  const router = useRouter();
  const [uid, setUid] = useState(null);
  const [allowed, setAllowed] = useState(null);
  const [loadError, setLoadError] = useState("");

  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [dismissals, setDismissals] = useState([]);

  const [keepChoice, setKeepChoice] = useState({}); // groupId -> id to keep
  const [confirming, setConfirming] = useState(null); // { kind, group, keepId } | { dismiss: true, kind, group }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const [companiesSnap, contactsSnap, customersSnap, pipelineSnap, dismissalsSnap] = await Promise.all([
      getDocs(collection(db, "companies")),
      getDocs(collection(db, "contacts")),
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "pipeline")),
      getDocs(collection(db, "duplicateDismissals"))
    ]);
    setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setCustomers(withoutTrashed(customersSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
    setPipeline(withoutTrashed(pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
    setDismissals(dismissalsSnap.docs.map(d => d.data().groupId));
  };

  useEffect(() => {
    let timer;
    const unsub = onAuthStateChanged(auth, async (user) => {
      const loginTimestamp = Number(localStorage.getItem("loginTimestamp") || 0);
      const elapsed = Date.now() - loginTimestamp;
      if (!user || !loginTimestamp || elapsed > SESSION_LENGTH_MS) {
        localStorage.removeItem("loginTimestamp");
        signOut(auth);
        router.push("/");
        return;
      }
      timer = setTimeout(() => {
        localStorage.removeItem("loginTimestamp");
        signOut(auth);
        router.push("/");
      }, SESSION_LENGTH_MS - elapsed);
      setUid(user.uid);

      try {
        const profileSnap = await getDoc(doc(db, "users", user.uid));
        const profile = profileSnap.exists() ? profileSnap.data() : null;
        if (!profile || profile.disabled || profile.role !== "admin") {
          setAllowed(false);
          return;
        }
        setAllowed(true);
        await load();
        // Older companies predate the uniqueness keys; make sure they all have one.
        directoryAction("syncKeys").catch(() => {});
      } catch (err) {
        setLoadError(err.message || "Couldn't load the directory.");
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const usage = (name) => ({
    projects: customers.filter(c => sameCompany(c.company, name) || (c.owners || []).some(o => sameCompany(o.company, name))).length,
    pipeline: pipeline.filter(p => sameCompany(p.company, name) || (p.biddingCompanies || []).some(b => sameCompany(b.company, name))).length
  });

  const companyGroups = useMemo(
    () => groupSimilarCompanies(companies)
      .filter(g => !dismissals.includes(groupIdOf(g)))
      .map(g => g.map(c => ({ ...c, people: contacts.filter(p => p.companyId === c.id).length, used: usage(c.name) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companies, contacts, customers, pipeline, dismissals]
  );

  const peopleGroups = useMemo(
    () => groupSimilarPeople(contacts).filter(g => !dismissals.includes(groupIdOf(g))),
    [contacts, dismissals]
  );

  // Default keeper: the company used on the most jobs, then the one with the most people.
  const defaultKeep = (group, kind) => {
    if (kind === "people") {
      return [...group].sort((a, b) => (emailsOf(b).length + phonesOf(b).length) - (emailsOf(a).length + phonesOf(a).length))[0].id;
    }
    return [...group].sort((a, b) =>
      (b.used.projects + b.used.pipeline) - (a.used.projects + a.used.pipeline) || b.people - a.people
    )[0].id;
  };
  const keepIdFor = (group, kind) => keepChoice[groupIdOf(group)] || defaultKeep(group, kind);

  const runConfirmed = async () => {
    const { kind, group, keepId, dismiss } = confirming;
    setBusy(true);
    setError("");
    try {
      if (dismiss) {
        await directoryAction("dismissGroup", { groupId: groupIdOf(group), kind });
        setNotice("Marked as not duplicates.");
      } else {
        const result = await directoryAction(kind === "people" ? "mergePeople" : "mergeCompanies", {
          keepId,
          mergeIds: group.map(r => r.id).filter(id => id !== keepId)
        });
        const kept = group.find(r => r.id === keepId);
        setNotice(`Merged into ${kept.name}. ${result.records || 0} project/pipeline record${result.records === 1 ? "" : "s"} updated${result.peopleCombined ? `, ${result.peopleCombined} matching people combined` : ""}.`);
      }
      setConfirming(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (allowed === false) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Admins only</h3>
          <p className="modal-subtitle">Only an admin can find and merge duplicates.</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory")}>Back to Directory</button>
        </div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn&apos;t load the directory</h3>
          <p className="modal-subtitle">{loadError}</p>
        </div>
      </div>
    );
  }
  if (allowed === null) return <div className="dashboard-page">Loading...</div>;

  const renderGroup = (group, kind) => {
    const gid = groupIdOf(group);
    const keepId = keepIdFor(group, kind);
    const kept = group.find(r => r.id === keepId);
    const companyOf = (p) => companies.find(c => c.id === p.companyId);
    return (
      <div key={gid} className="duplicate-group">
        <div className="duplicate-group-head">
          <strong>
            {kind === "people"
              ? `${group.length} people at ${companyOf(group[0])?.name || group[0].companyName || "the same company"} look like the same person`
              : `${group.length} companies look like the same firm`}
          </strong>
          <span className="private-note-hint" style={{ margin: 0 }}>Pick the one to keep</span>
        </div>
        {group.map(r => (
          <label key={r.id} className={`duplicate-row ${r.id === keepId ? "is-keep" : ""}`} htmlFor={`keep-${gid}-${r.id}`}>
            <input
              id={`keep-${gid}-${r.id}`}
              type="radio"
              name={`keep-${gid}`}
              checked={r.id === keepId}
              onChange={() => setKeepChoice(prev => ({ ...prev, [gid]: r.id }))}
            />
            <span className="duplicate-row-main">
              <span className="duplicate-row-name">
                {r.name}
                {r.id === keepId && <span className="role-badge role-badge-admin">Keep</span>}
              </span>
              {kind === "people" ? (
                <span className="notes-history-date">
                  {[r.title, ...emailsOf(r), ...phonesOf(r).map(formatPhone)].filter(Boolean).join(" · ") || "No contact info"}
                </span>
              ) : (
                <span className="notes-history-date">
                  {[r.category, `${r.people} ${r.people === 1 ? "person" : "people"}`, `${r.used.projects} project${r.used.projects === 1 ? "" : "s"}`, `${r.used.pipeline} pipeline`, r.phone && formatPhone(r.phone), r.address].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
            {kind !== "people" && (
              <a className="link-muted" href={`/dashboard/directory/company/${r.id}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>Open</a>
            )}
          </label>
        ))}
        <div className="duplicate-group-actions">
          <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirming({ dismiss: true, kind, group })}>Not duplicates</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => setConfirming({ kind, group, keepId })}>Merge into {kept?.name}</button>
        </div>
      </div>
    );
  };

  const confirmText = () => {
    const { kind, group, keepId, dismiss } = confirming;
    if (dismiss) return { title: "Not duplicates?", body: `${group.map(r => r.name).join(", ")} will stop showing here. They stay as separate ${kind === "people" ? "people" : "companies"}.`, label: "Not duplicates" };
    const kept = group.find(r => r.id === keepId);
    const others = group.filter(r => r.id !== keepId);
    return kind === "people"
      ? {
          title: `Merge into ${kept.name}?`,
          body: `${others.map(r => r.name).join(", ")} will be combined into ${kept.name}, keeping every email and phone number (differences get a "Needs review" flag). Projects and pipeline entries that list them will list ${kept.name}. This can't be undone.`,
          label: "Merge"
        }
      : {
          title: `Merge into ${kept.name}?`,
          body: `${others.map(r => r.name).join(", ")} will be combined into ${kept.name}: their people move over, any different phone numbers, addresses or websites are kept for review, and every project and pipeline entry that names them will name ${kept.name}. This can't be undone.`,
          label: "Merge"
        };
  };

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Find Duplicates</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory")}>← Back to Directory</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page duplicates-page">
        <p className="private-note-hint" style={{ marginTop: 0 }}>
          Names that look like the same company or person entered more than once — different punctuation, Inc/LLC, typos, or nicknames.
          Review each group: merge it into the record to keep, or mark it as not duplicates.
        </p>
        {notice && <p className="settings-status is-ok">{notice}</p>}
        {error && <p className="settings-status is-error">{error}</p>}

        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>Companies ({companyGroups.length})</h4>
          {companyGroups.length === 0 && <p className="private-note-hint">No duplicate companies found.</p>}
          {companyGroups.map(g => renderGroup(g, "companies"))}
        </div>

        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>People ({peopleGroups.length})</h4>
          {peopleGroups.length === 0 && <p className="private-note-hint">No duplicate people found.</p>}
          {peopleGroups.map(g => renderGroup(g, "people"))}
        </div>
      </div>

      {confirming && (() => {
        const t = confirmText();
        return (
          <ConfirmDialog title={t.title} confirmLabel={t.label} busy={busy} onCancel={() => setConfirming(null)} onConfirm={runConfirmed}>
            <p>{t.body}</p>
            {error && <p className="settings-status is-error">{error}</p>}
          </ConfirmDialog>
        );
      })()}
    </div>
  );
}
