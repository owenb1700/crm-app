"use client";

import { useEffect, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "../../lib/firebase";
import { dateKeyOf, isImageFile, preparePhoto } from "../../lib/photos";
import ConfirmDialog from "./ConfirmDialog";

// Photos on a project or pipeline entry. Everyone who can open the entry
// sees them; `canAdd` decides who can upload, and each photo can be edited
// or deleted by whoever uploaded it or by `canManageAll` (owner / admin).
// Each photo is its own document in the entry's `photos` subcollection with
// a date (defaults to when the photo was taken) and an optional caption.
export default function PhotoGallery({ kind, recordId, uid, myName, canAdd, canManageAll }) {
  const collectionName = kind === "project" ? "customers" : "pipeline";
  const photosCol = () => collection(db, collectionName, recordId, "photos");

  const [photos, setPhotos] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(null); // [{ file, date, caption, previewUrl, error }]
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [viewId, setViewId] = useState(null);
  const [editing, setEditing] = useState(null); // { date, caption }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const load = async () => {
    try {
      const snap = await getDocs(photosCol());
      setPhotos(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")))
      );
      setLoadError("");
    } catch (err) {
      setLoadError(err.message || "Couldn't load photos.");
    }
  };

  useEffect(() => {
    if (recordId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  const canManage = (photo) => canManageAll || photo.uploadedBy === uid;

  // Picking or dropping files opens the details step (date + caption each).
  const choose = (fileList) => {
    const files = Array.from(fileList || []).filter(isImageFile);
    if (!files.length) return;
    setUploadError("");
    setPending(files.map(file => ({
      file,
      date: dateKeyOf(new Date(file.lastModified || Date.now())),
      caption: "",
      previewUrl: file.type.startsWith("image/") && !/hei[cf]/i.test(file.type) ? URL.createObjectURL(file) : null
    })));
  };

  const closePending = () => {
    (pending || []).forEach(p => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    setPending(null);
    setUploadError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const uploadAll = async () => {
    setUploading(true);
    setUploadError("");
    const failed = [];
    for (const item of pending) {
      try {
        const { blob, width, height, previewUrl } = await preparePhoto(item.file);
        URL.revokeObjectURL(previewUrl);
        const safeName = (item.file.name || "photo").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 60);
        const path = `${collectionName}/${recordId}/photos/${Date.now()}-${safeName}.jpg`;
        const fileRef = ref(storage, path);
        await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
        const url = await getDownloadURL(fileRef);
        await addDoc(photosCol(), {
          url,
          path,
          width,
          height,
          size: blob.size,
          originalName: item.file.name || null,
          date: item.date || dateKeyOf(new Date()),
          caption: item.caption.trim() || null,
          uploadedBy: uid,
          uploadedByName: myName || null,
          uploadedAt: new Date().toISOString()
        });
      } catch (err) {
        failed.push(`${item.file.name}: ${err.message}`);
      }
    }
    setUploading(false);
    await load();
    if (failed.length) {
      setUploadError(`${failed.length} photo${failed.length === 1 ? "" : "s"} couldn't be uploaded — ${failed.join("; ")}`);
      setPending(prev => prev.filter(p => failed.some(f => f.startsWith(`${p.file.name}:`))));
    } else {
      closePending();
    }
  };

  const viewIndex = viewId ? photos.findIndex(p => p.id === viewId) : -1;
  const viewing = viewIndex >= 0 ? photos[viewIndex] : null;
  const showAt = (i) => {
    setEditing(null);
    setViewId(photos[i]?.id || null);
  };

  const saveEdit = async () => {
    try {
      await updateDoc(doc(db, collectionName, recordId, "photos", viewing.id), {
        date: editing.date || viewing.date,
        caption: editing.caption.trim() || null
      });
      setEditing(null);
      await load();
    } catch (err) {
      alert(`Couldn't save: ${err.message}`);
    }
  };

  const removePhoto = async (photo) => {
    try {
      await deleteDoc(doc(db, collectionName, recordId, "photos", photo.id));
      try {
        await deleteObject(ref(storage, photo.path));
      } catch {
        // Already gone from storage (or kept for a converted project); the record is removed either way.
      }
      setConfirmDelete(null);
      setViewId(null);
      await load();
    } catch (err) {
      alert(`Couldn't delete: ${err.message}`);
    }
  };

  // Keyboard arrows / Escape in the viewer.
  useEffect(() => {
    if (!viewing || editing || confirmDelete) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setViewId(null);
      if (e.key === "ArrowRight" && viewIndex < photos.length - 1) showAt(viewIndex + 1);
      if (e.key === "ArrowLeft" && viewIndex > 0) showAt(viewIndex - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, viewIndex, editing, confirmDelete, photos]);

  return (
    <div
      className={`project-section detail-span-full photo-section ${dragOver ? "is-drag-over" : ""}`}
      onDragOver={canAdd ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
      onDragLeave={canAdd ? () => setDragOver(false) : undefined}
      onDrop={canAdd ? (e) => { e.preventDefault(); setDragOver(false); choose(e.dataTransfer.files); } : undefined}
    >
      <div className="photo-section-head">
        <h4 className="field-label" style={{ margin: 0 }}>Photos{photos.length ? ` (${photos.length})` : ""}</h4>
        {canAdd && (
          <>
            <input
              ref={inputRef}
              id={`photo-input-${recordId}`}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              className="photo-input"
              onChange={e => choose(e.target.files)}
            />
            <label htmlFor={`photo-input-${recordId}`} className="btn btn-primary">+ Add Photos</label>
          </>
        )}
      </div>

      {loadError && <p className="settings-status is-error">⚠ Couldn&apos;t load photos: {loadError}</p>}
      {!loadError && photos.length === 0 && (
        <p className="private-note-hint">
          No photos yet.{canAdd ? " Add them from your phone, tablet, or computer — or drag photos here." : ""}
        </p>
      )}

      {photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((p, i) => (
            <button key={p.id} type="button" className="photo-tile" onClick={() => setViewId(p.id)}>
              <img src={p.url} alt={p.caption || `Photo from ${p.date}`} loading="lazy" />
              <span className="photo-tile-meta">
                <span className="photo-tile-date">{p.date}</span>
                {p.caption && <span className="photo-tile-caption">{p.caption}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Date + caption for each photo before uploading */}
      {pending && (
        <div className="modal-overlay">
          <div className="modal-card photo-upload-modal" role="dialog" aria-modal="true" aria-labelledby="photo-upload-title">
            <h3 id="photo-upload-title" className="modal-title">Add {pending.length} photo{pending.length === 1 ? "" : "s"}</h3>
            <p className="modal-subtitle">Set a date for each photo and add a caption if you want.</p>
            <div className="photo-upload-list">
              {pending.map((item, i) => (
                <div key={`${item.file.name}-${i}`} className="photo-upload-row">
                  <div className="photo-upload-thumb">
                    {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span>{item.file.name}</span>}
                  </div>
                  <div className="photo-upload-fields">
                    <label className="field-label" htmlFor={`photo-date-${i}`}>Date</label>
                    <input
                      id={`photo-date-${i}`}
                      type="date"
                      className="field"
                      value={item.date}
                      onChange={e => setPending(prev => prev.map((p, x) => (x === i ? { ...p, date: e.target.value } : p)))}
                    />
                    <label className="field-label" htmlFor={`photo-caption-${i}`}>Caption (optional)</label>
                    <input
                      id={`photo-caption-${i}`}
                      className="field"
                      autoComplete="off"
                      placeholder="e.g. Basin after cleaning"
                      value={item.caption}
                      onChange={e => setPending(prev => prev.map((p, x) => (x === i ? { ...p, caption: e.target.value } : p)))}
                    />
                  </div>
                  {!uploading && (
                    <button
                      type="button"
                      className="link-muted photo-upload-remove"
                      onClick={() => {
                        if (pending.length === 1) return closePending();
                        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
                        setPending(pending.filter((_, x) => x !== i));
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            {uploadError && <p className="settings-status is-error">{uploadError}</p>}
            <div className="modal-actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-secondary" disabled={uploading} onClick={closePending}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={uploading} onClick={uploadAll}>
                {uploading ? "Uploading…" : `Upload ${pending.length} photo${pending.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-size viewer */}
      {viewing && (
        <div className="modal-overlay photo-viewer-overlay" onClick={() => { setViewId(null); setEditing(null); }}>
          <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="Photo" onClick={e => e.stopPropagation()}>
            <div className="photo-viewer-image">
              <img src={viewing.url} alt={viewing.caption || `Photo from ${viewing.date}`} />
              {viewIndex > 0 && (
                <button type="button" className="photo-nav photo-nav-prev" aria-label="Previous photo" onClick={() => showAt(viewIndex - 1)}>‹</button>
              )}
              {viewIndex < photos.length - 1 && (
                <button type="button" className="photo-nav photo-nav-next" aria-label="Next photo" onClick={() => showAt(viewIndex + 1)}>›</button>
              )}
            </div>
            <div className="photo-viewer-info">
              {editing ? (
                <div className="photo-edit">
                  <div>
                    <label className="field-label" htmlFor="photo-edit-date">Date</label>
                    <input id="photo-edit-date" type="date" className="field" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} />
                  </div>
                  <div className="photo-edit-caption">
                    <label className="field-label" htmlFor="photo-edit-caption">Caption</label>
                    <input id="photo-edit-caption" className="field" autoComplete="off" value={editing.caption} onChange={e => setEditing({ ...editing, caption: e.target.value })} />
                  </div>
                  <div className="photo-viewer-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                    <button type="button" className="btn btn-primary" onClick={saveEdit}>Save</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="photo-viewer-text">
                    <div className="photo-viewer-date">{viewing.date} <span className="photo-viewer-count">· {viewIndex + 1} of {photos.length}</span></div>
                    {viewing.caption && <div className="photo-viewer-caption">{viewing.caption}</div>}
                    <div className="notes-history-date">Added by {viewing.uploadedByName || "Unknown"} on {String(viewing.uploadedAt || "").slice(0, 10)}</div>
                  </div>
                  <div className="photo-viewer-actions">
                    <a className="btn btn-secondary" href={viewing.url} target="_blank" rel="noopener noreferrer">Open full size</a>
                    {canManage(viewing) && (
                      <>
                        <button type="button" className="btn btn-secondary" onClick={() => setEditing({ date: viewing.date || "", caption: viewing.caption || "" })}>Edit</button>
                        <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(viewing)}>Delete</button>
                      </>
                    )}
                    <button type="button" className="btn btn-secondary" onClick={() => setViewId(null)}>Close</button>
                  </div>
                </>
              )}
            </div>
          </div>

          {confirmDelete && (
            <div onClick={e => e.stopPropagation()}>
              <ConfirmDialog
                title="Delete this photo?"
                confirmLabel="Delete photo"
                danger
                onCancel={() => setConfirmDelete(null)}
                onConfirm={() => removePhoto(confirmDelete)}
              >
                <p>{confirmDelete.caption || `Photo from ${confirmDelete.date}`} will be removed for everyone. This can&apos;t be undone.</p>
              </ConfirmDialog>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
