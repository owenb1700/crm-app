"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
import { isTrashed } from "../../../lib/trash";
import PhotoGallery from "../../components/PhotoGallery";
import DashboardHeader from "../../components/DashboardHeader";
import MobileNav from "../../components/MobileNav";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

// Every photo on one project or pipeline entry, each with its date and
// caption. The record's own page shows only the newest few and links here.
function PhotoGalleryPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const kind = searchParams.get("kind") === "pipeline" ? "pipeline" : "project";
  const recordId = searchParams.get("id") || "";

  const [uid, setUid] = useState(null);
  const [profile, setProfile] = useState(null);
  const [record, setRecord] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [notFound, setNotFound] = useState(false);

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
        if (!profileSnap.exists() || profileSnap.data().disabled) {
          localStorage.removeItem("loginTimestamp");
          await signOut(auth);
          router.push("/");
          return;
        }
        setProfile(profileSnap.data());

        const snap = await getDoc(doc(db, kind === "pipeline" ? "pipeline" : "customers", recordId));
        if (!snap.exists() || isTrashed(snap.data())) {
          setNotFound(true);
          return;
        }
        setRecord({ id: snap.id, ...snap.data() });
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading these photos.");
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, recordId]);

  const backToRecord = () => router.push(kind === "pipeline" ? `/dashboard/pipeline/${recordId}` : `/dashboard/project/${recordId}`);

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn&apos;t load these photos</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>Back to My Projects</button>
        </div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Not found</h3>
          <p className="modal-subtitle">This {kind === "pipeline" ? "pipeline entry" : "project"} may have been deleted.</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>Back to My Projects</button>
        </div>
      </div>
    );
  }
  if (!record || !profile) return <div className="dashboard-page">Loading...</div>;

  const isOwner = record.ownerId === uid;
  const isAdmin = profile.role === "admin";
  const isCollaborator = (record.collaboratorIds || []).includes(uid);
  const canAdd = kind === "pipeline" ? true : (isOwner || isCollaborator || isAdmin);
  const canManageAll = isOwner || isAdmin;
  const title = kind === "pipeline" ? (record.title || "Pipeline entry") : (record.projectName || record.company || "Project");

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Photos — {title}</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={backToRecord}>
            ← Back to {kind === "pipeline" ? "pipeline entry" : "project"}
          </button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <PhotoGallery
          kind={kind}
          recordId={recordId}
          uid={uid}
          myName={profile.firstName && profile.lastName ? `${profile.firstName} ${profile.lastName}` : auth.currentUser?.email}
          canAdd={canAdd}
          canManageAll={canManageAll}
          limit={0}
          showGalleryLink={false}
        />
      </div>
    </div>
  );
}

export default function PhotoGalleryPage() {
  return (
    <Suspense fallback={<div className="dashboard-page">Loading...</div>}>
      <PhotoGalleryPageContent />
    </Suspense>
  );
}
