import { getAdminDb, getAdminAuth } from "../../../lib/firebaseAdmin";
import { purgeExpiredTrash } from "../../../lib/deleteRecord";
import { purgeAtFrom } from "../../../lib/trash";

// Lists the signed-in user's Trash: deleted projects and pipeline entries
// they own (whoever deleted them), or every deleted one for an admin.
// Anything past its 30 days is deleted for good first, so the list never
// shows something already expired.
export async function GET(req) {
  const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return Response.json({ error: "Missing auth token" }, { status: 401 });
  }

  let callerUid;
  try {
    callerUid = (await getAdminAuth().verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: "Your session expired -- refresh the page and try again" }, { status: 401 });
  }

  const db = getAdminDb();
  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.exists ? callerSnap.data() : null;
  if (!caller || caller.disabled) {
    return Response.json({ error: "No active account" }, { status: 403 });
  }

  try {
    await purgeExpiredTrash();
  } catch {
    // Expired items are retried by the daily job; still show the list.
  }

  const [projectsSnap, pipelineSnap, partsSnap, usersSnap] = await Promise.all([
    db.collection("customers").where("deletedAt", ">", "").get(),
    db.collection("pipeline").where("deletedAt", ">", "").get(),
    db.collection("parts").where("deletedAt", ">", "").get(),
    db.collection("users").get()
  ]);
  const nameOf = new Map(usersSnap.docs.map(d => {
    const u = d.data();
    return [d.id, u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email];
  }));

  const isAdmin = caller.role === "admin";
  const visible = (data) => isAdmin || data.ownerId === callerUid;
  const item = (kind, d) => {
    const data = d.data();
    return {
      kind,
      id: d.id,
      name: kind === "project"
        ? (data.projectName || data.company || "Untitled project")
        : kind === "part" ? (data.item || "Parts request") : (data.title || "Untitled pipeline entry"),
      sub: kind === "project"
        ? [data.company !== data.projectName ? data.company : "", data.category].filter(Boolean).join(" · ")
        : kind === "part"
          ? [data.company, data.stage].filter(Boolean).join(" · ")
          : [data.stage, data.outcome].filter(Boolean).join(" · "),
      owner: nameOf.get(data.ownerId) || "Unknown",
      deletedAt: data.deletedAt,
      deletedBy: nameOf.get(data.deletedBy) || "Unknown",
      purgeAt: data.purgeAt || purgeAtFrom(data.deletedAt)
    };
  };

  const items = [
    ...projectsSnap.docs.filter(d => visible(d.data())).map(d => item("project", d)),
    ...pipelineSnap.docs.filter(d => visible(d.data())).map(d => item("pipeline", d)),
    ...partsSnap.docs.filter(d => visible(d.data())).map(d => item("part", d))
  ].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));

  return Response.json({ items, isAdmin });
}
