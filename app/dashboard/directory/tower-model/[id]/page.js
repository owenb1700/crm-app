"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db, storage } from "../../../../../lib/firebase";
import { doc, getDoc, updateDoc, getDocs, collection } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import DashboardHeader from "../../../../components/DashboardHeader";
import MobileNav from "../../../../components/MobileNav";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

const formatBytes = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function TowerModelDetail() {
  const params = useParams();
  const router = useRouter();
  const modelId = params.id;

  const [uid, setUid] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const [towerModel, setTowerModel] = useState(null);
  const [projects, setProjects] = useState([]);
  const [pipelineJobs, setPipelineJobs] = useState([]);
  const [uploading, setUploading] = useState(false);

  const loadTowerModel = async () => {
    const snap = await getDoc(doc(db, "towerModels", modelId));
    if (!snap.exists()) {
      setNotFound(true);
      return;
    }
    const data = { id: snap.id, ...snap.data() };
    setTowerModel(data);

    const [customersSnap, pipelineSnap] = await Promise.all([
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "pipeline"))
    ]);

    const mfr = (data.manufacturer || "").toLowerCase();
    const mdl = (data.model || "").toLowerCase();
    const matches = (entry) => {
      const entryMfr = (entry.towerManufacturer || "").toLowerCase();
      const entryMdl = (entry.modelNumber || "").toLowerCase();
      if (mfr && mdl) return entryMfr === mfr && entryMdl === mdl;
      if (mfr) return entryMfr === mfr && !entryMdl;
      return entryMdl === mdl && !entryMfr;
    };

    setProjects(customersSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(matches));
    setPipelineJobs(pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(matches));
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
        setMyProfile(profileSnap.data());

        await loadTowerModel();
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading this tower model.");
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  const uploadDrawing = async (fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      return alert("Only PDF files can be uploaded here");
    }

    setUploading(true);
    try {
      const path = `towerModels/${modelId}/${Date.now()}-${file.name}`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);

      const newFile = {
        name: file.name,
        path,
        url,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        uploadedByName: myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : (auth.currentUser?.email || "Unknown")
      };

      await updateDoc(doc(db, "towerModels", modelId), {
        drawings: [...(towerModel.drawings || []), newFile]
      });

      await loadTowerModel();
    } catch (err) {
      alert(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const deleteDrawing = async (file) => {
    if (!window.confirm(`Delete "${file.name}"? This can't be undone.`)) return;

    try {
      await deleteObject(ref(storage, file.path));
    } catch {
      // file may already be gone from storage; still clean up the metadata
    }

    await updateDoc(doc(db, "towerModels", modelId), {
      drawings: (towerModel.drawings || []).filter(f => f.path !== file.path)
    });

    await loadTowerModel();
  };

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load this tower model</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.back()}>Back</button>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Tower model not found</h3>
          <button className="btn btn-secondary" onClick={() => router.back()}>Back</button>
        </div>
      </div>
    );
  }

  if (!towerModel) {
    return <div className="dashboard-page">Loading...</div>;
  }

  const displayName = [towerModel.manufacturer, towerModel.model].filter(Boolean).join(" — ") || "Unnamed Model";

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Tower Model</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.back()}>← Back</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <div className="project-section">
          <h2 className="modal-title" style={{ marginBottom: 2 }}>{displayName}</h2>
          <p><strong>Manufacturer:</strong> {towerModel.manufacturer || "—"}</p>
          <p><strong>Model Number:</strong> {towerModel.model || "—"}</p>
        </div>

        <div className="project-section">
          <h4 className="field-label">Drawings (PDF)</h4>
          <p className="private-note-hint" style={{ marginBottom: 10 }}>
            Shared across every tower of this model — visible and editable by anyone signed in.
          </p>

          {(towerModel.drawings || []).length === 0 && (
            <p className="private-note-hint">No drawings uploaded yet.</p>
          )}
          {(towerModel.drawings || []).map((f, i) => (
            <div key={i} className="notes-history-item notes-history-row">
              <div>
                <a className="link-muted" href={f.url} target="_blank" rel="noopener noreferrer">{f.name}</a>
                <div className="notes-history-date">
                  {formatBytes(f.size)} · uploaded by {f.uploadedByName} · {f.uploadedAt?.slice(0, 10)}
                </div>
              </div>
              <button className="btn btn-danger" onClick={() => deleteDrawing(f)}>Delete</button>
            </div>
          ))}

          <div style={{ marginTop: 12 }}>
            <input
              type="file"
              accept="application/pdf"
              disabled={uploading}
              onChange={e => uploadDrawing(e.target.files)}
            />
            {uploading && <p className="private-note-hint">Uploading...</p>}
          </div>
        </div>

        <div className="project-section">
          <h4 className="field-label">Projects ({projects.length})</h4>
          {projects.length === 0 && <p className="private-note-hint">No projects use this tower model.</p>}
          {projects.map(p => (
            <div key={p.id} className="notes-history-item" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/project/${p.id}`)}>
              <div><strong>{p.projectName || p.company}</strong></div>
              <div className="notes-history-date">Serial: {p.serialNumber || "—"}</div>
            </div>
          ))}
        </div>

        <div className="project-section">
          <h4 className="field-label">Pipeline Entries ({pipelineJobs.length})</h4>
          {pipelineJobs.length === 0 && <p className="private-note-hint">No pipeline entries use this tower model.</p>}
          {pipelineJobs.map(p => (
            <div key={p.id} className="notes-history-item" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/pipeline/${p.id}`)}>
              <div><strong>{p.title}</strong></div>
              <div className="notes-history-date">{[p.stage, p.bidDate && `Bid ${p.bidDate}`].filter(Boolean).join(" · ") || "—"}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
