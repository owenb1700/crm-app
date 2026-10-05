// Which alerts go out as email as well as under the bell, and the switch
// in User Settings that turns each one off.
//
// The bell always shows everything. These only decide whether it also
// lands in somebody's inbox, which matters for the ones that can sit
// unseen for days -- a share of a job, a firm you cover turning up on an
// entry, a project filed in your name.
//
// The nightly "bid date passed" nudge is deliberately not here. It fires
// from a cron job across every overdue entry rather than from a person
// doing something, and it already goes out in the daily digest; emailing
// it too would mean several a morning repeating what the digest said.

export const ALERT_EMAILS = [
  {
    type: "collab_request",
    pref: "notifyCollabRequest",
    label: "Someone asks to collaborate on one of my projects",
    subject: (message) => message
  },
  {
    type: "collab_approved",
    pref: "notifyCollabApproved",
    label: "My request to collaborate is approved",
    subject: () => "Your collaboration request was approved"
  },
  {
    type: "collab_denied",
    pref: "notifyCollabDenied",
    label: "My request to collaborate is turned down",
    subject: () => "Your collaboration request was turned down"
  },
  {
    type: "split_share",
    pref: "notifySplitShare",
    label: "I'm given a share of a job",
    subject: () => "You were given a share of a job"
  },
  {
    type: "firm_on_entry",
    pref: "notifyFirmOnEntry",
    label: "A firm I cover is added to a pipeline entry",
    subject: () => "A firm you cover is on a new pipeline entry"
  },
  {
    type: "assigned",
    pref: "notifyAssigned",
    label: "A project is entered for me by someone else",
    subject: () => "A project was entered for you"
  },
  {
    type: "reactivated",
    pref: "notifyReactivated",
    label: "A closed project of mine is reopened",
    subject: () => "A closed project was reopened"
  },
  {
    type: "note",
    pref: "notifyNote",
    label: "Someone adds a note on a job and picks me",
    subject: () => "A note was added on a job you're on"
  }
];

const BY_TYPE = new Map(ALERT_EMAILS.map(a => [a.type, a]));

export const emailableAlert = (type) => BY_TYPE.get(type) || null;

// Off only when somebody has actually turned it off. A user record written
// before a switch existed has nothing stored for it, and silence there
// means on -- the same rule the two collaboration emails have always used.
export const wantsAlertEmail = (user, type) => {
  const alert = emailableAlert(type);
  if (!alert) return false;
  return user?.[alert.pref] !== false;
};

export const alertEmailSubject = (type, message) => {
  const alert = emailableAlert(type);
  return alert ? alert.subject(message) : message;
};

// The body. One sentence saying what happened and a way back into the app
// -- the detail lives on the record, not in the mail.
export function alertEmailHtml({ message, link, appUrl }) {
  const href = link ? `${String(appUrl || "").replace(/\/$/, "")}${link}` : null;
  return [
    `<p>${escapeHtml(message)}</p>`,
    href ? `<p><a href="${href}">Open it in the CRM</a></p>` : "",
    `<p style="color:#6b7280;font-size:12px">You can turn these emails off under User Settings. The alerts bell shows them either way.</p>`
  ].filter(Boolean).join("");
}

const escapeHtml = (text) =>
  String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
