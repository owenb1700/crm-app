"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
import { withoutTrashed } from "../../../lib/trash";
import { personName } from "../../../lib/people";
import { hasShare } from "../../../lib/splits";
import { buildCalendarWeeks, visibleCalendarDays, columnLabels, WEEKEND_COLUMNS } from "../../../lib/calendarDays";
import CalendarNav from "../../components/CalendarNav";
import {
  laborByDate, laborForStorage, blankLaborSchedule, laborDays, menOnDate,
  isOverbooked, overbookedDates, describeLabor, crewCapacity,
  clashesOn, clashDates, describeClashes
} from "../../../lib/laborSchedule";
import DashboardHeader from "../../components/DashboardHeader";
import MobileNav from "../../components/MobileNav";
import ViewTabs from "../../components/ViewTabs";
import LaborScheduleEditor from "../../components/LaborScheduleEditor";
import ConfirmDialog from "../../components/ConfirmDialog";
import JobPicker from "../../components/JobPicker";
import { CREW_COLLECTION, crewNames, crewForStorage, crewError, peopleOn, crewTitles, crewLabel, titleOf } from "../../../lib/crew";

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
  // The people who actually do the work. Names only -- no accounts, no
  // logins. An admin keeps the list; anyone can put them on a day.
  const [crew, setCrew] = useState([]);
  const [showCrew, setShowCrew] = useState(false);
  const [newCrewName, setNewCrewName] = useState("");
  const [newCrewTitle, setNewCrewTitle] = useState("");
  const [crewSaving, setCrewSaving] = useState(false);
  const [crewProblem, setCrewProblem] = useState("");
  // Clearing a whole job's schedule is worth a second look.
  const [confirmClear, setConfirmClear] = useState(null);

  // The popup: either a day that was clicked, or a job being scheduled.
  const [openDay, setOpenDay] = useState(null);       // "YYYY-MM-DD"
  const [editing, setEditing] = useState(null);       // { projectId, draft }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [calendarAnchor, setCalendarAnchor] = useState(() => new Date());

  const load = async () => {
    const [projectsSnap, usersSnap, crewSnap] = await Promise.all([
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "users")),
      getDocs(collection(db, CREW_COLLECTION))
    ]);
    setCrew(crewSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    // Closed jobs stay on the board. The calendar is a record of when
    // work happened as much as a plan for what's coming, and dropping a
    // job the day it closed took its crew days off the days they were
    // actually worked. They can still be scheduled too -- work gets
    // booked against a job that's already been closed out often enough.
    setProjects(withoutTrashed(projectsSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
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
  // Which four weeks are on screen. Work gets scheduled months out, so
  // this moves with the arrows or straight to a date.
  const calendarWeeks = useMemo(() => buildCalendarWeeks(calendarAnchor, new Date()), [calendarAnchor]);
  // Always seven columns here, unlike Home. Home hides an empty Saturday
  // or Sunday because its weeks are mostly weekdays and the grid stays
  // tidy; this board is crews and shipments, where weekend work is
  // ordinary, and columns appearing and vanishing as jobs move made the
  // whole calendar jump about. A fixed week reads evenly.
  const weekendColumns = useMemo(() => new Set(WEEKEND_COLUMNS), []);
  const calendarDays = useMemo(() => visibleCalendarDays(calendarWeeks, weekendColumns), [calendarWeeks, weekendColumns]);
  const labels = useMemo(() => columnLabels(weekendColumns), [weekendColumns]);
  // The crew list is the capacity: hire two and the number moves on its
  // own. Before anyone has written the list down there's no number to be
  // over, so those warnings stay quiet.
  const capacity = useMemo(() => crewCapacity(crew), [crew]);
  const overbooked = useMemo(() => overbookedDates(byDate, capacity), [byDate, capacity]);
  // Somebody standing on two jobs at once is a separate problem from the
  // day being busy, and it's the one that actually strands a job.
  const clashDays = useMemo(() => clashDates(byDate), [byDate]);

  const projectById = (id) => projects.find(p => p.id === id);

  // What the search picker offers: every project, closed ones marked, and
  // whose it is when it isn't yours.
  const projectOptions = useMemo(
    () => [...projects]
      .sort((a, b) => String(a.projectName || a.company || "").localeCompare(String(b.projectName || b.company || "")))
      .map(p => ({
        key: `project:${p.id}`,
        kind: "project",
        id: p.id,
        label: `${p.projectName || p.company || "Untitled"}${p.category === "Project Closed" ? " (closed)" : ""}`,
        sub: [p.company, p.projectAddress, p.ownerId !== uid ? nameOf(p.ownerId) : null].filter(Boolean).join(" · ")
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, users, uid]
  );

  // Work that's yours: your own jobs, and anything you hold a share of.
  // The board shows everybody's, so the ones you're accountable for need
  // to be findable at a glance.
  const myProjectIds = useMemo(
    () => new Set(projects.filter(p => p.ownerId === uid || hasShare(p, uid)).map(p => p.id)),
    [projects, uid]
  );

  const startEditing = (projectId, date) => {
    const project = projectById(projectId);
    const draft = project?.laborSchedule
      ? { includeWeekends: project.laborSchedule.includeWeekends === true, days: laborDays(project).map(d => ({ ...d })) }
      : { ...blankLaborSchedule(), days: date ? [{ date, men: 0 }] : [] };
    setSaveError("");
    setEditing({ projectId, draft });
  };

  const addCrewMember = async () => {
    const problem = crewError({ name: newCrewName }, crew);
    if (problem) return setCrewProblem(problem);
    setCrewSaving(true);
    setCrewProblem("");
    try {
      await addDoc(collection(db, CREW_COLLECTION), {
        ...crewForStorage({ name: newCrewName, title: newCrewTitle }),
        createdAt: new Date().toISOString(),
        createdBy: uid
      });
      setNewCrewName("");
      setNewCrewTitle("");
      await load();
    } catch (err) {
      setCrewProblem(
        /permission|insufficient/i.test(err.message || "")
          ? "Only an admin can change the crew list."
          : `Couldn't add them: ${err.message}`
      );
    } finally {
      setCrewSaving(false);
    }
  };

  const removeCrewMember = async (member) => {
    setCrewProblem("");
    try {
      await deleteDoc(doc(db, CREW_COLLECTION, member.id));
      await load();
    } catch (err) {
      setCrewProblem(
        /permission|insufficient/i.test(err.message || "")
          ? "Only an admin can change the crew list."
          : `Couldn't remove them: ${err.message}`
      );
    }
  };

  // Straight from the day popup: take this job off this one day, or off
  // the calendar entirely. Going through the editor for it meant opening
  // a form to delete something.
  const writeLabor = async (projectId, days, includeWeekends, message) => {
    setSaveError("");
    try {
      const payload = laborForStorage({ days, includeWeekends });
      await updateDoc(doc(db, "customers", projectId), {
        laborSchedule: payload.days.length
          ? { ...payload, updatedAt: new Date().toISOString(), updatedBy: uid }
          : null
      });
      setNotice(message);
      setOpenDay(null);
      await load();
    } catch (err) {
      setSaveError(
        /permission|insufficient/i.test(err.message || "")
          ? "You don't have permission to change this job's schedule."
          : `Couldn't change this schedule: ${err.message}`
      );
    }
  };

  const removeDayFromJob = (projectId, date) => {
    const project = projectById(projectId);
    writeLabor(
      projectId,
      laborDays(project).filter(d => d.date !== date),
      project?.laborSchedule?.includeWeekends,
      `Taken off ${date}.`
    );
  };

  const clearJobLabor = (projectId) => {
    const project = projectById(projectId);
    writeLabor(projectId, [], project?.laborSchedule?.includeWeekends, "All manpower removed from this job.");
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
              Everyone&apos;s work, four weeks at a time.{" "}
              {capacity > 0
                ? `${capacity} on the crew.`
                : "Add the crew list and days over the crew get flagged."}
              {overbooked.length > 0 && (
                <> <strong style={{ color: "var(--color-warning-strong)" }}>⚠ {overbooked.length} {overbooked.length === 1 ? "day is" : "days are"} over the crew.</strong></>
              )}
              {clashDays.length > 0 && (
                <> <strong style={{ color: "var(--color-warning-strong)" }}>⚠ {clashDays.length} {clashDays.length === 1 ? "day has" : "days have"} someone on two jobs.</strong></>
              )}
            </span>
            <span className="list-toolbar-add" style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-secondary" onClick={() => setShowCrew(v => !v)}>
                Crew ({crewNames(crew).length}) {showCrew ? "▾" : "▸"}
              </button>
              <button className="btn btn-primary" onClick={() => { setOpenDay(null); startEditing("", ""); }}>
                Add Manpower
              </button>
            </span>
          </div>

          {notice && <p className="private-note-hint">{notice}</p>}

          {/* The crew list. Names only -- these aren't accounts and nobody
              here signs in. An admin keeps it; everyone reads it, because
              anyone scheduling a job picks from it. */}
          {showCrew && (
            <div className="admin-card" style={{ marginBottom: 16 }}>
              <h4 className="field-label" style={{ marginTop: 0 }}>Crew</h4>
              <p className="private-note-hint" style={{ marginTop: -4 }}>
                The people who do the work. Names only — no logins, no accounts.
                {role === "admin" ? " Anyone can put them on a day; only you can change the list." : " Only an admin can change this list."}
              </p>

              {crewNames(crew).length === 0 && (
                <p className="private-note-hint">Nobody on the list yet.</p>
              )}

              <div className="crew-pick" style={{ marginBottom: 10 }}>
                {[...crew]
                  .filter(c => (c.name || "").trim())
                  .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                  .map(member => (
                    <span key={member.id} className="crew-chip crew-chip-on">
                      {crewLabel(member)}
                      {role === "admin" && (
                        <button
                          type="button"
                          className="crew-chip-remove"
                          aria-label={`Remove ${member.name} from the crew list`}
                          title="Remove from the list"
                          onClick={() => removeCrewMember(member)}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
              </div>

              {role === "admin" && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    className="field"
                    style={{ marginBottom: 0, maxWidth: 240 }}
                    placeholder="Add a name..."
                    value={newCrewName}
                    onChange={e => { setNewCrewName(e.target.value); setCrewProblem(""); }}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCrewMember(); } }}
                  />
                  <input
                    className="field"
                    style={{ marginBottom: 0, maxWidth: 170 }}
                    list="crew-titles"
                    placeholder="Foreman, Labor…"
                    aria-label="What they do"
                    value={newCrewTitle}
                    onChange={e => setNewCrewTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCrewMember(); } }}
                  />
                  {/* Offers the standing titles and anything already typed,
                      without stopping somebody typing a new one. */}
                  <datalist id="crew-titles">
                    {crewTitles(crew).map(t => <option key={t} value={t} />)}
                  </datalist>
                  <button className="btn btn-secondary" disabled={crewSaving || !newCrewName.trim()} onClick={addCrewMember}>
                    {crewSaving ? "Adding…" : "Add"}
                  </button>
                </div>
              )}

              {crewProblem && <p className="settings-status is-error" style={{ marginTop: 8 }}>⚠ {crewProblem}</p>}

              <p className="private-note-hint" style={{ marginTop: 10 }}>
                Someone hired in for a job who isn&apos;t on this list can still be typed onto a day —
                they show in amber and never join the list.
              </p>
            </div>
          )}

          <CalendarNav anchor={calendarAnchor} onAnchor={setCalendarAnchor} idPrefix="sched-cal" />

          <div className="calendar-wrap">
            <div className="calendar-weekday-header" style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}>
              {labels.map(d => <div key={d} className="calendar-weekday">{d}</div>)}
            </div>

            <div className="calendar-grid" style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}>
              {calendarDays.map(({ date, key, isToday }) => {
                const entries = byDate.get(key) || [];
                const total = menOnDate(byDate, key);
                const over = isOverbooked(byDate, key, capacity);
                const clashes = clashesOn(byDate, key);
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
                          style={{ marginLeft: 6, background: over ? "var(--color-warning-bg)" : undefined, color: over ? "var(--color-warning-strong)" : undefined }}
                          title={
                            over
                              ? `${total} men booked — ${total - capacity} more than the crew`
                              : capacity > 0 ? `${total} of ${capacity} men booked` : `${total} men booked`
                          }
                        >
                          {over ? "⚠ " : ""}{total}
                        </span>
                      )}
                      {/* A separate mark, because a double booking can
                          sit on a day that's nowhere near capacity. */}
                      {clashes.length > 0 && (
                        <span
                          className="calendar-day-clash"
                          title={describeClashes(clashes)}
                        >
                          ⚠
                        </span>
                      )}
                    </div>
                    <div className="calendar-day-events">
                      {entries.slice(0, 3).map(e => (
                        <div
                          key={`${e.projectId}-${e.date}`}
                          className={`calendar-event-pill ${myProjectIds.has(e.projectId) ? "calendar-event-pill-mine" : ""}`}
                          title={myProjectIds.has(e.projectId) ? "Yours" : undefined}
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
            <p className="private-note-hint">No work scheduled in these four weeks. Step through the weeks above, or use Add Manpower to put a job on the calendar.</p>
          )}
        </>
      )}

      {/* A day's work: who's on what, how heavy the day is, and a way in
          to each job. Notes are never here -- not hidden by this page, but
          never read in the first place. */}
      {openDay && !editing && (
        <div className="modal-overlay" onClick={() => setOpenDay(null)}>
          <div className="modal-card modal-wide day-sheet" role="dialog" aria-labelledby="day-title" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setOpenDay(null)} aria-label="Close">✕</button>

            {/* The day itself, and how full it is, read first -- that's
                what somebody opening a square wants to know. */}
            <div className="day-sheet-head">
              <div>
                <h3 id="day-title" className="day-sheet-date">
                  {new Date(`${openDay}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                </h3>
                <p className="day-sheet-sub">
                  {dayEntries.length} {dayEntries.length === 1 ? "job" : "jobs"} on this day
                </p>
              </div>
              <div className={`day-sheet-load ${isOverbooked(byDate, openDay, capacity) ? "is-over" : ""}`}>
                <div className="day-sheet-count">
                  {menOnDate(byDate, openDay)}
                  {capacity > 0 && <span className="day-sheet-of"> / {capacity}</span>}
                </div>
                {capacity > 0 && (
                  <div className="day-sheet-bar">
                    <span style={{ width: `${Math.min(100, (menOnDate(byDate, openDay) / capacity) * 100)}%` }} />
                  </div>
                )}
                <div className="day-sheet-load-label">
                  {isOverbooked(byDate, openDay, capacity)
                    ? `${menOnDate(byDate, openDay) - capacity} more than the crew`
                    : "men booked"}
                </div>
              </div>
            </div>

            {clashesOn(byDate, openDay).length > 0 && (
              <p className="day-sheet-clash">
                ⚠ {describeClashes(clashesOn(byDate, openDay))}
              </p>
            )}

            <div className="day-sheet-jobs">
              {dayEntries.map(e => {
                const project = projectById(e.projectId);
                const day = (project?.laborSchedule?.days || []).find(d => d.date === openDay);
                const named = peopleOn(day);
                const closed = project?.category === "Project Closed";
                return (
                  <div key={e.projectId} className="day-job">
                    <div className="day-job-head">
                      <div>
                        <div className="day-job-name">{e.name}</div>
                        {project?.company && <div className="day-job-firm">{project.company}</div>}
                      </div>
                      <div className="day-job-tags">
                        {myProjectIds.has(e.projectId) && <span className="role-badge role-badge-admin">Yours</span>}
                        {closed && <span className="role-badge">Closed</span>}
                        <span className="day-job-men">{e.men} {e.men === 1 ? "man" : "men"}</span>
                      </div>
                    </div>

                    <div className="day-job-crew">
                      {named.length
                        ? named.map(n => (
                            <span
                              key={n}
                              className={`crew-chip crew-chip-on ${crewNames(crew).some(c => c.toLowerCase() === n.toLowerCase()) ? "" : "crew-chip-outside"}`}
                              title={titleOf(n, crew) || "Not on the crew list"}
                            >
                              {n}
                              {titleOf(n, crew) && <span className="crew-chip-title">{titleOf(n, crew)}</span>}
                            </span>
                          ))
                        : <span className="private-note-hint">Nobody named on this day yet</span>}
                    </div>

                    <dl className="day-job-facts">
                      {project?.projectAddress && <><dt>Address</dt><dd>{project.projectAddress}</dd></>}
                      {project?.workType && <><dt>Work</dt><dd>{project.workType}</dd></>}
                      <dt>Owner</dt><dd>{nameOf(project?.ownerId) || "—"}</dd>
                      {project?.category && (
                        <>
                          <dt>Status</dt>
                          <dd>{project.category}{closed && project.closedAt ? ` — closed ${String(project.closedAt).slice(0, 10)}` : ""}</dd>
                        </>
                      )}
                      {project && describeLabor(project) && <><dt>Whole job</dt><dd>{describeLabor(project)}</dd></>}
                    </dl>

                    <div className="day-job-actions">
                      <button className="btn btn-secondary btn-small" onClick={() => startEditing(e.projectId, openDay)}>Edit manpower</button>
                      <button className="btn btn-secondary btn-small" onClick={() => router.push(`/dashboard/project/${e.projectId}`)}>Open project</button>
                      <button className="btn btn-secondary btn-small" onClick={() => removeDayFromJob(e.projectId, openDay)}>Remove this day</button>
                      <button className="btn btn-secondary btn-small day-job-danger" onClick={() => setConfirmClear(e.projectId)}>Remove all days</button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="day-sheet-foot">
              <span className="private-note-hint">Private notes stay on the project and aren&apos;t shown here.</span>
              <button className="btn btn-primary" onClick={() => startEditing("", openDay)}>Add another job to this day</button>
            </div>
          </div>
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Remove all manpower from this job?"
          confirmLabel="Remove all"
          danger
          onConfirm={() => { const id = confirmClear; setConfirmClear(null); clearJobLabor(id); }}
          onCancel={() => setConfirmClear(null)}
        >
          <p className="modal-subtitle">
            Every day booked on &quot;{projectById(confirmClear)?.projectName || projectById(confirmClear)?.company || "this job"}&quot;
            comes off the calendar, past days included. The job itself isn&apos;t touched.
          </p>
        </ConfirmDialog>
      )}

      {/* Scheduling a job: pick which one, then set the days and men. */}
      {editing && (
        <div className="modal-overlay" onClick={() => !saving && setEditing(null)}>
          <div className="modal-card labor-sheet" role="dialog" aria-labelledby="labor-title" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => !saving && setEditing(null)} aria-label="Close">✕</button>
            <h3 id="labor-title" className="modal-title" style={{ marginTop: 0 }}>
              {editingProject ? editingProject.projectName || editingProject.company : "Add manpower"}
            </h3>

            {!editing.projectId ? (
              <>
                <p className="modal-subtitle">Manpower always belongs to a job. Pick the one this work is for.</p>
                <label className="field-label" htmlFor="labor-project">Project</label>
                {/* The same search-as-you-type picker reminders use to
                    attach a job. A dropdown was fine with a handful of
                    projects and unusable with a few hundred. */}
                <JobPicker
                  id="labor-project"
                  options={projectOptions}
                  value=""
                  onChange={key => key && startEditing(key.replace(/^project:/, ""), openDay)}
                  placeholder="Search projects..."
                  emptyText="No matching projects"
                />
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
                  crew={crew}
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

// MobileNav reads the URL's query string, which Next wants wrapped --
// without this the production build refuses to prerender the page.
export default function SchedulingPage() {
  return (
    <Suspense fallback={<div className="dashboard-page">Loading the schedule...</div>}>
      <SchedulingPageContent />
    </Suspense>
  );
}
