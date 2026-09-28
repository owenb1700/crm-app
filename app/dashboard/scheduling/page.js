"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
import { withoutTrashed } from "../../../lib/trash";
import { personName } from "../../../lib/people";
import { buildCalendarWeeks, weekendColumnsFor, visibleCalendarDays, columnLabels } from "../../../lib/calendarDays";
import {
  laborByDate, laborForStorage, blankLaborSchedule, laborDays, menOnDate,
  isOverbooked, overbookedDates, describeLabor, CREW_CAPACITY
} from "../../../lib/laborSchedule";
import DashboardHeader from "../../components/DashboardHeader";
import MobileNav from "../../components/MobileNav";
import ViewTabs from "../../components/ViewTabs";
import LaborScheduleEditor from "../../components/LaborScheduleEditor";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const clearSession = () => localStorage.removeItem("loginTimestamp");

// Project Scheduling: when the work on every job is actually happening,
// and how many men are on it each day.
//
// Everyone sees the whole company's schedule -- that's the point of it --
// and anyone can put labour against any job, including one they don't own.
// What they can't see is anybody's private notes: those live in a
// subcollection the rules only open to the project's own people, so this
// page never reads them and the popup never shows them.
function SchedulingPageContent() {
  const router = useRouter();

  const [uid, setUid] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [role, setRole] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);

  // The popup: either a day that was clicked, or a job being scheduled.
  const [openDay, setOpenDay] = useState(null);       // "YYYY-MM-DD"
  const [editing, setEditing] = useState(null);       // { projectId, draft }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    const [projectsSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "users"))
    ]);
    // Closed jobs aren't scheduled work any more, so they stay off the board.
    setProjects(
      withoutTrashed(projectsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        .filter(p => p.category !== "Project Closed")
    );
    setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
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
        if (!profileSnap.exists() || profileSnap.data().disabled) {
          clearSession();
          await signOut(auth);
          router.push("/");
          return;
        }
        setMyProfile(profileSnap.data());
        setRole(profileSnap.data().role);
        await load();
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading the schedule.");
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameOf = (id) => personName(users.find(u => u.id === id)) || "";

  const byDate = useMemo(() => laborByDate(projects), [projects]);
  const calendarWeeks = useMemo(() => buildCalendarWeeks(new Date()), []);
  const weekendColumns = useMemo(
    () => weekendColumnsFor(calendarWeeks, (key) => (byDate.get(key) || []).length > 0),
    [calendarWeeks, byDate]
  );
  const calendarDays = useMemo(() => visibleCalendarDays(calendarWeeks, weekendColumns), [calendarWeeks, weekendColumns]);
  const labels = useMemo(() => columnLabels(weekendColumns), [weekendColumns]);
  const overbooked = useMemo(() => overbookedDates(byDate), [byDate]);

  const projectById = (id) => projects.find(p => p.id === id);

  const startEditing = (projectId, date) => {
    const project = projectById(projectId);
    const draft = project?.laborSchedule
      ? { includeWeekends: project.laborSchedule.includeWeekends === true, days: laborDays(project).map(d => ({ ...d })) }
      : { ...blankLaborSchedule(), days: date ? [{ date, men: 0 }] : [] };
    setSaveError("");
    setEditing({ projectId, draft });
  };

  const saveLabor = async () => {
    if (!editing?.projectId) return;
    setSaving(true);
    setSaveError("");
    try {
      const payload = laborForStorage(editing.draft);
      await updateDoc(doc(db, "customers", editing.projectId), {
        laborSchedule: { ...payload, updatedAt: new Date().toISOString(), updatedBy: uid }
      });
      setNotice(payload.days.length ? "Schedule saved." : "Schedule cleared.");
      setEditing(null);
      await load();
    } catch (err) {
      // Never swallow this: if the rules refuse the write, say so plainly
      // rather than closing the box as though it had worked.
      setSaveError(
        /permission|insufficient/i.test(err.message || "")
          ? "You don't have permission to schedule this job. The labour rule may not be deployed to this Firebase project yet."
          : `Couldn't save this schedule: ${err.message}`
      );
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn&apos;t load the schedule</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>Back to My Projects</button>
        </div>
      </div>
    );
  }

  const dayEntries = openDay ? (byDate.get(openDay) || []) : [];
  const editingProject = editing ? projectById(editing.projectId) : null;

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} profile={myProfile ? { ...myProfile, role } : null} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Project Scheduling</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>← Back to My Projects</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      {myProfile
        ? <ViewTabs profile={{ ...myProfile, role }} role={role} view="scheduling" searchData={{}} />
        : (
          <div className="view-tabs" aria-hidden="true">
            <button className="tab-btn" style={{ visibility: "hidden" }} tabIndex={-1}>Home</button>
          </div>
        )}

      {!loaded ? (
        <p className="modal-subtitle">Loading the schedule...</p>
      ) : (
        <>
          <div className="list-toolbar">
            <span className="private-note-hint" style={{ margin: 0 }}>
              Everyone&apos;s work, next 4 weeks. {CREW_CAPACITY} men is a normal day.
              {overbooked.length > 0 && (
                <> <strong style={{ color: "#b45309" }}>⚠ {overbooked.length} {overbooked.length === 1 ? "day is" : "days are"} over.</strong></>
              )}
            </span>
            <span className="list-toolbar-add">
              <button className="btn btn-primary" onClick={() => { setOpenDay(null); startEditing("", ""); }}>
                ADD MANPOWER
              </button>
            </span>
          </div>

          {notice && <p className="private-note-hint">{notice}</p>}

          <div className="calendar-wrap">
            <div className="calendar-weekday-header" style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}>
              {labels.map(d => <div key={d} className="calendar-weekday">{d}</div>)}
            </div>

            <div className="calendar-grid" style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}>
              {calendarDays.map(({ date, key, isToday }) => {
                const entries = byDate.get(key) || [];
                const total = menOnDate(byDate, key);
                const over = isOverbooked(byDate, key);
                return (
                  <div
                    key={key}
                    className={`calendar-day ${isToday ? "calendar-day-today" : ""}`}
                    onClick={() => entries.length && setOpenDay(key)}
                    style={entries.length ? { cursor: "pointer" } : undefined}
                  >
                    <div className="calendar-day-number">
                      {date.getDate()}
                      {total > 0 && (
                        <span
                          className="role-badge"
                          style={{ marginLeft: 6, background: over ? "#fef3c7" : undefined, color: over ? "#b45309" : undefined }}
                          title={over ? `${total} men booked — over the usual ${CREW_CAPACITY}` : `${total} of ${CREW_CAPACITY} men booked`}
                        >
                          {over ? "⚠ " : ""}{total}
                        </span>
                      )}
                    </div>
                    <div className="calendar-day-events">
                      {entries.slice(0, 3).map(e => (
                        <div
                          key={`${e.projectId}-${e.date}`}
                          className="calendar-event-pill"
                          onClick={(ev) => { ev.stopPropagation(); setOpenDay(key); }}
                        >
                          {e.name} · {e.men}
                        </div>
                      ))}
                      {entries.length > 3 && <div className="calendar-event-more">+{entries.length - 3} more</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {calendarDays.every(({ key }) => !(byDate.get(key) || []).length) && (
            <p className="private-note-hint">No work scheduled in the next 4 weeks. Use ADD MANPOWER to put a job on the calendar.</p>
          )}
        </>
      )}

      {/* A day's work: who's on what, how heavy the day is, and a way in
          to each job. Notes are never here -- not hidden by this page, but
          never read in the first place. */}
      {openDay && !editing && (
        <div className="modal-overlay" onClick={() => setOpenDay(null)}>
          <div className="modal-card" role="dialog" aria-labelledby="day-title" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setOpenDay(null)} aria-label="Close">✕</button>
            <h3 id="day-title" className="modal-title" style={{ marginTop: 0 }}>{openDay}</h3>
            <p className={`modal-subtitle ${isOverbooked(byDate, openDay) ? "" : ""}`} style={isOverbooked(byDate, openDay) ? { color: "#b45309" } : undefined}>
              {isOverbooked(byDate, openDay) ? "⚠ " : ""}
              {menOnDate(byDate, openDay)} of {CREW_CAPACITY} men booked
              {isOverbooked(byDate, openDay) ? ` — ${menOnDate(byDate, openDay) - CREW_CAPACITY} over` : ""}
            </p>

            {dayEntries.map(e => {
              const project = projectById(e.projectId);
              return (
                <div key={e.projectId} className="admin-card" style={{ marginBottom: 10 }}>
                  <div className="customer-name">{e.name}</div>
                  <div className="customer-meta">{e.men} {e.men === 1 ? "man" : "men"} on this day</div>
                  {project && (
                    <>
                      {project.company && <div className="customer-meta">{project.company}</div>}
                      {project.projectAddress && <div className="customer-meta">{project.projectAddress}</div>}
                      {project.workType && <div className="customer-meta">{project.workType}</div>}
                      <div className="customer-meta">Owner: {nameOf(project.ownerId) || "—"}</div>
                      <div className="customer-meta">{describeLabor(project)}</div>
                    </>
                  )}
                  <div className="modal-actions" style={{ marginTop: 8 }}>
                    <button className="btn btn-secondary" onClick={() => startEditing(e.projectId, openDay)}>Edit manpower</button>
                    <button className="btn btn-secondary" onClick={() => router.push(`/dashboard/project/${e.projectId}`)}>Open project</button>
                  </div>
                </div>
              );
            })}

            <p className="private-note-hint">Private notes stay on the project and aren&apos;t shown here.</p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => startEditing("", openDay)}>Add another job to this day</button>
            </div>
          </div>
        </div>
      )}

      {/* Scheduling a job: pick which one, then set the days and men. */}
      {editing && (
        <div className="modal-overlay" onClick={() => !saving && setEditing(null)}>
          <div className="modal-card" role="dialog" aria-labelledby="labor-title" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => !saving && setEditing(null)} aria-label="Close">✕</button>
            <h3 id="labor-title" className="modal-title" style={{ marginTop: 0 }}>
              {editingProject ? editingProject.projectName || editingProject.company : "Add manpower"}
            </h3>

            {!editing.projectId ? (
              <>
                <p className="modal-subtitle">Manpower always belongs to a job. Pick the one this work is for.</p>
                <label className="field-label" htmlFor="labor-project">Project</label>
                <select
                  id="labor-project"
                  className="field"
                  value=""
                  onChange={e => e.target.value && startEditing(e.target.value, openDay)}
                >
                  <option value="">Select a project...</option>
                  {[...projects]
                    .sort((a, b) => String(a.projectName || a.company || "").localeCompare(String(b.projectName || b.company || "")))
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.projectName || p.company || "Untitled"}{p.ownerId !== uid ? ` — ${nameOf(p.ownerId) || "someone else"}` : ""}
                      </option>
                    ))}
                </select>
                <p className="private-note-hint">
                  You can schedule a job that isn&apos;t yours. You still won&apos;t see its private notes.
                </p>
              </>
            ) : (
              <>
                {editingProject && editingProject.ownerId !== uid && (
                  <p className="private-note-hint">
                    This job belongs to {nameOf(editingProject.ownerId) || "someone else"}. You can set its manpower; their notes stay private.
                  </p>
                )}
                <LaborScheduleEditor
                  idPrefix="labor-modal"
                  value={editing.draft}
                  onChange={draft => setEditing(prev => ({ ...prev, draft }))}
                  byDate={byDate}
                  projectId={editing.projectId}
                />
                {saveError && <p className="settings-status is-error">⚠ {saveError}</p>}
                <div className="modal-actions">
                  <button className="btn btn-secondary" disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
                  <button className="btn btn-primary" disabled={saving} onClick={saveLabor}>
                    {saving ? "Saving…" : "Save schedule"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SchedulingPage() {
  return <SchedulingPageContent />;
}
