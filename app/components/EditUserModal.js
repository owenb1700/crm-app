"use client";

import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { PERMISSION_DEFS, ROLE_OPTIONS, roleLabel, effectivePermissions } from "../../lib/permissions";
import ConfirmDialog from "./ConfirmDialog";

const nameOf = (u) => (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email);

// Everything an admin can do to one account, behind a single Edit User
// button. Role and permission edits are held as a draft until Save
// changes, which (like deactivating, reactivating, and deleting) asks for
// confirmation first. The window only closes through its own buttons.
export default function EditUserModal({ user, ownedCounts, onClose, onChanged, onExport }) {
  const startPerms = effectivePermissions(user.role || "member", user.permissions);
  const [role, setRole] = useState(user.role || "member");
  const [perms, setPerms] = useState(startPerms);
  const [confirm, setConfirm] = useState(null); // { kind, ... }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const typicalFor = (p) => (p.defaultForRoles || []).includes(role);

  const roleChanged = role !== (user.role || "member");
  const permChanges = PERMISSION_DEFS
    .filter(() => role !== "admin")
    .filter(p => !!perms[p.key] !== !!startPerms[p.key])
    .map(p => ({ label: p.label, on: !!perms[p.key] }));
  const hasChanges = roleChanged || permChanges.length > 0;

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const saveChanges = () => run(async () => {
    await updateDoc(doc(db, "users", user.id), { role, permissions: perms });
    setConfirm(null);
    onChanged?.(`${nameOf(user)} updated`);
    onClose();
  });

  const toggleDisabled = () => run(async () => {
    const nowDisabled = !user.disabled;
    // Server-side: it also turns off their sign-in and drops any session
    // they still have open, which the app alone can't do.
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch("/api/admin/set-user-active", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ uid: user.id, disabled: nowDisabled })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.code ? `${data.error} (code ${data.code})` : (data.error || "Couldn't change this account"));
    setConfirm(null);
    onChanged?.(`${nameOf(user)} ${nowDisabled ? "deactivated" : "reactivated"}`);
    onClose();
  });

  const deleteUser = () => run(async () => {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch("/api/admin/delete-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ uid: user.id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.code ? `${data.error} (code ${data.code} -- admins have been emailed)` : (data.error || "Couldn't delete this account"));
    setConfirm(null);
    onChanged?.(`${nameOf(user)} deleted`, { deleted: true });
    onClose();
  });

  const sendResetLink = () => run(async () => {
    const res = await fetch("/api/send-reset-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't send reset link");
    setNotice(`Reset link sent to ${user.email}`);
  });

  const requestClose = () => {
    if (hasChanges) setConfirm({ kind: "discard" });
    else onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card edit-user-modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
        <div className="edit-user-head">
          <div>
            <h3 id="edit-user-title" className="modal-title" style={{ margin: 0 }}>{nameOf(user)}</h3>
            <p className="export-modal-who">{user.email}</p>
          </div>
          <span className={`role-badge ${user.disabled ? "" : "role-badge-admin"}`}>{user.disabled ? "Deactivated" : "Active"}</span>
        </div>

        <section className="edit-user-section">
          <label className="field-label" htmlFor="edit-user-role" style={{ marginTop: 0 }}>Role</label>
          <select id="edit-user-role" className="field" value={role} onChange={e => setRole(e.target.value)}>
            {ROLE_OPTIONS.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>

          <div className="field-label">Access</div>
          {role === "admin" ? (
            <p className="private-note-hint" style={{ marginTop: 0 }}>Admins have access to everything.</p>
          ) : (
            <div className="edit-user-perms">
              {PERMISSION_DEFS.map(p => (
                <label key={p.key} className="settings-check" htmlFor={`edit-user-perm-${p.key}`}>
                  <input
                    id={`edit-user-perm-${p.key}`}
                    type="checkbox"
                    checked={!!perms[p.key]}
                    onChange={() => setPerms(prev => ({ ...prev, [p.key]: !prev[p.key] }))}
                  />
                  <span>
                    {p.label}
                    {typicalFor(p) && <span className="private-note-hint" style={{ margin: "0 0 0 6px" }}>(usual for {roleLabel(role)})</span>}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="edit-user-save">
            <button className="btn btn-primary" disabled={!hasChanges || busy} onClick={() => setConfirm({ kind: "save" })}>
              Save changes
            </button>
            {!hasChanges && <span className="private-note-hint" style={{ margin: 0 }}>No unsaved changes</span>}
          </div>
        </section>

        <section className="edit-user-section">
          <div className="field-label" style={{ marginTop: 0 }}>Account</div>
          <div className="edit-user-actions">
            {!user.disabled && (
              <button className="btn btn-secondary" disabled={busy} onClick={sendResetLink}>Send Reset Link</button>
            )}
            {user.role !== "admin" && (
              <button className="btn btn-secondary" disabled={busy} onClick={() => onExport(user)}>Export Data</button>
            )}
          </div>
          {notice && <p className="settings-status is-ok">{notice}</p>}
        </section>

        <section className="edit-user-section edit-user-danger">
          <div className="field-label" style={{ marginTop: 0 }}>Danger zone</div>
          <div className="edit-user-actions">
            <button className="btn btn-danger" disabled={busy} onClick={() => setConfirm({ kind: "disable" })}>
              {user.disabled ? "Reactivate account" : "Deactivate account"}
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => setConfirm({ kind: "delete" })}>Delete permanently</button>
          </div>
        </section>

        {error && !confirm && <p className="settings-status is-error">{error}</p>}

        <div className="modal-actions" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" disabled={busy} onClick={requestClose}>Close</button>
        </div>
      </div>

      {confirm?.kind === "save" && (
        <ConfirmDialog
          title={`Save changes to ${nameOf(user)}?`}
          confirmLabel="Save changes"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={saveChanges}
        >
          <ul className="confirm-list">
            {roleChanged && <li>Role: {roleLabel(user.role || "member")} → <strong>{roleLabel(role)}</strong></li>}
            {permChanges.map(c => (
              <li key={c.label}>{c.label}: <strong>{c.on ? "turned on" : "turned off"}</strong></li>
            ))}
          </ul>
          {error && <p className="settings-status is-error">{error}</p>}
        </ConfirmDialog>
      )}

      {confirm?.kind === "disable" && (
        <ConfirmDialog
          title={user.disabled ? `Reactivate ${nameOf(user)}?` : `Deactivate ${nameOf(user)}?`}
          confirmLabel={user.disabled ? "Reactivate" : "Deactivate"}
          danger={!user.disabled}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={toggleDisabled}
        >
          <p>
            {user.disabled
              ? "They'll be able to sign in again and reset their password."
              : "Their sign-in is switched off and any session they still have open stops working. Their data stays as it is."}
          </p>
          {error && <p className="settings-status is-error">{error}</p>}
        </ConfirmDialog>
      )}

      {confirm?.kind === "delete" && (
        <ConfirmDialog
          title={`Permanently delete ${nameOf(user)}?`}
          confirmLabel="Delete permanently"
          danger
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={deleteUser}
        >
          <p>Their login stops working immediately. This can't be undone.</p>
          {(ownedCounts.projects > 0 || ownedCounts.pipeline > 0) && (
            <p>
              {ownedCounts.projects} project{ownedCounts.projects === 1 ? "" : "s"} and {ownedCounts.pipeline} pipeline
              entr{ownedCounts.pipeline === 1 ? "y" : "ies"} they own will be reassigned to you.
            </p>
          )}
          {error && <p className="settings-status is-error">{error}</p>}
        </ConfirmDialog>
      )}

      {confirm?.kind === "discard" && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          confirmLabel="Discard"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={onClose}
        >
          <p>Your role or access changes for {nameOf(user)} haven't been saved.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
