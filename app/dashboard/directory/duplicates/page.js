"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { auth, db } from "../../../../lib/firebase";
import { directoryAction } from "../../../../lib/directory";
import { groupIdOf, groupSimilarCompanies, groupSimilarPeople, sameCompany } from "../../../../lib/companyMatch";
import { collectAddresses, groupSimilarAddresses, addressGroupId } from "../../../../lib/addresses";
import { withoutTrashed } from "../../../../lib/trash";
import { emailsOf, phonesOf } from "../../../../lib/directoryConflicts";
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
  const [parts, setParts] = useState([]);
  const [dismissals, setDismissals] = useState([]);

  const [keepChoice, setKeepChoice] = useState({}); // groupId -> id to keep
  const [confirming, setConfirming] = useState(null); // { kind, group, keepId } | { dismiss: true, kind, group }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const [companiesSnap, contactsSnap, customersSnap, pipelineSnap, dismissalsSnap, partsSnap] = await Promise.all([
      getDocs(collection(db, "companies")),
      getDocs(collection(db, "contacts")),
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "pipeline")),
      getDocs(collection(db, "duplicateDismissals")),
      getDocs(collection(db, "parts"))
    ]);
    setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setCustomers(withoutTrashed(customersSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
    setPipeline(withoutTrashed(pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
    setParts(withoutTrashed(partsSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
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

  // Buildings written more than one way. An address is text on the work
  // rather than a record, so a "group" here is spellings, and the id is
  // built from their comparable forms.
  const addressGroups = useMemo(
    () => groupSimilarAddresses(collectAddresses({ projects: customers, pipeline, parts }))
      .filter(g => !dismissals.includes(addressGroupId(g))),
    [customers, pipeline, parts, dismissals]
  );

  // Default keeper: the company used on the most jobs, then the one with the most people.
  const defaultKeep = (group, kind) => {
    if (kind === "addresses") {
      // Keep the spelling used on the most work; the fullest wording
      // breaks a tie, since that's usually the complete one.
      return [...group].sort((a, b) => b.total - a.total || b.label.length - a.label.length)[0].key;
    }
    if (kind === "people") {
      return [...group].sort((a, b) => (emailsOf(b).length + phonesOf(b).length) - (emailsOf(a).length + phonesOf(a).length))[0].id;
    }
    return [...group].sort((a, b) =>
      (b.used.projects + b.used.pipeline) - (a.used.projects + a.used.pipeline) || b.people - a.people
    )[0].id;
  };
  // Firms and people are identified by document id; a building by its
  // comparable address.
  const idOfGroup = (group, kind) => (kind === "addresses" ? addressGroupId(group) : groupIdOf(group));
  const idOfRow = (row, kind) => (kind === "addresses" ? row.key : row.id);
  const keepIdFor = (group, kind) => keepChoice[idOfGroup(group, kind)] || defaultKeep(group, kind);

  const runConfirmed = async () => {
    const { kind, group, keepId, dismiss } = confirming;
    setBusy(true);
    setError("");
    try {
      if (dismiss) {
        await directoryAction("dismissGroup", { groupId: idOfGroup(group, kind), kind });
        setNotice("Marked as not duplicates.");
      } else if (kind === "addresses") {
        const kept = group.find(r => r.key === keepId);
        const result = await directoryAction("mergeAddresses", {
          keepLabel: kept.label,
          mergeLabels: group.filter(r => r.key !== keepId).map(r => r.label)
        });
        setNotice(`Merged into ${kept.label}. ${result.records || 0} record${result.records === 1 ? "" : "s"} moved${result.sectorsKept ? ", sector kept" : ""}.`);
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
    const gid = idOfGroup(group, kind);
    const keepId = keepIdFor(group, kind);
    const kept = group.find(r => idOfRow(r, kind) === keepId);
    const companyOf = (p) => companies.find(c => c.id === p.companyId);
    return (
      <div key={gid} className="duplicate-group">
        <div className="duplicate-group-head">
          <strong>
            {kind === "people"
              ? `${group.length} people at ${companyOf(group[0])?.name || group[0].companyName || "the same company"} look like the same person`
              : kind === "addresses"
                ? `${group.length} spellings look like the same building`
                : `${group.length} companies look like the same firm`}
          </strong>
          <span className="private-note-hint" style={{ margin: 0 }}>
            {kind === "addresses" ? "Pick the spelling to keep" : "Pick the one to keep"}
          </span>
        </div>
        {group.map(r => {
          const rowId = idOfRow(r, kind);
          return (
          <label key={rowId} className={`duplicate-row ${rowId === keepId ? "is-keep" : ""}`} htmlFor={`keep-${gid}-${rowId}`}>
            <input
              id={`keep-${gid}-${rowId}`}
              type="radio"
              name={`keep-${gid}`}
              checked={rowId === keepId}
              onChange={() => setKeepChoice(prev => ({ ...prev, [gid]: rowId }))}
            />
            <span className="duplicate-row-main">
              <span className="duplicate-row-name">
                {kind === "addresses" ? r.label : r.name}
                {rowId === keepId && <span className="role-badge role-badge-admin">Keep</span>}
              </span>
              {kind === "addresses" ? (
                <span className="notes-history-date">
                  {[
                    `${r.total} ${r.total === 1 ? "job" : "jobs"}`,
                    r.counts.Project && `${r.counts.Project} project${r.counts.Project === 1 ? "" : "s"}`,
                    r.counts.Pipeline && `${r.counts.Pipeline} pipeline`,
                    r.counts.Parts && `${r.counts.Parts} parts`,
                    r.latest && `most recent ${r.latest}`
                  ].filter(Boolean).join(" · ")}
                </span>
              ) : kind === "people" ? (
                <span className="notes-history-date">
                  {[r.title, ...emailsOf(r), ...phonesOf(r).map(formatPhone)].filter(Boolean).join(" · ") || "No contact info"}
                </span>
              ) : (
                <span className="notes-history-date">
                  {[r.category, `${r.people} ${r.people === 1 ? "person" : "people"}`, `${r.used.projects} project${r.used.projects === 1 ? "" : "s"}`, `${r.used.pipeline} pipeline`, r.phone && formatPhone(r.phone), r.address].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
            {kind === "companies" && (
              <a className="link-muted" href={`/dashboard/directory/company/${r.id}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>Open</a>
            )}
            {kind === "addresses" && (
              <a className="link-muted" href={`/dashboard/directory/address/${encodeURIComponent(r.key)}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>Open</a>
            )}
          </label>
          );
        })}
        <div className="duplicate-group-actions">
          <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirming({ dismiss: true, kind, group })}>Not duplicates</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => setConfirming({ kind, group, keepId })}>
            Merge into {kind === "addresses" ? kept?.label : kept?.name}
          </button>
        </div>
      </div>
    );
  };

  const confirmText = () => {
    const { kind, group, keepId, dismiss } = confirming;
    if (dismiss) {
      const what = kind === "people" ? "people" : kind === "addresses" ? "buildings" : "companies";
      const names = group.map(r => (kind === "addresses" ? r.label : r.name)).join(", ");
      return { title: "Not duplicates?", body: `${names} will stop showing here. They stay as separate ${what}.`, label: "Not duplicates" };
    }
    if (kind === "addresses") {
      const keptRow = group.find(r => r.key === keepId);
      const otherRows = group.filter(r => r.key !== keepId);
      const moving = otherRows.reduce((sum, r) => sum + r.total, 0);
      return {
        title: `Merge into ${keptRow.label}?`,
        body: `${otherRows.map(r => r.label).join(", ")} will be rewritten as ${keptRow.label} on ${moving} record${moving === 1 ? "" : "s"} — projects, pipeline entries and parts orders alike — and any sector recorded against the other spellings moves across. Everything then gathers under one building. This can't be undone.`,
        label: "Merge"
      };
    }
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

      <div className="project-page">
        <p className="private-note-hint" style={{ marginTop: 0 }}>
          Companies, people and buildings that look like they were entered more than once — different punctuation, Inc/LLC, typos,
          nicknames, or an address written two ways. Review each group: merge it into the one to keep, or mark it as not duplicates.
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

        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>Buildings ({addressGroups.length})</h4>
          {addressGroups.length === 0 && <p className="private-note-hint">No buildings look like the same place.</p>}
          {addressGroups.map(g => renderGroup(g, "addresses"))}
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
