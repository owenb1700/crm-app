"use client";

import { firmTypeOf } from "../../lib/directory";
import { groupBidders, contactsOf } from "../../lib/bidders";

const formatPhone = (phone) => {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length !== 10) return phone;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const formatBytes = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const Row = ({ label, value }) => (
  <p><strong>{label}:</strong> {value || "—"}</p>
);

// The Bid History tab on a project that came from a won pipeline entry.
// `snapshot` is the frozen copy saved at conversion (or, for projects
// converted before snapshots existed, the live pipeline entry); `bidFiles`
// and `bidNotesHistory` come from the project's private doc and are null
// when the viewer isn't allowed to see them.
export default function BidHistory({ snapshot, isLive, bidFiles, canSeePrivate, personLabel }) {
  if (!snapshot) {
    return (
      <div className="project-section">
        <p className="private-note-hint">No bid history on file for this project.</p>
      </div>
    );
  }

  const ef = snapshot.engineeringFirm || {
    company: snapshot.company, contact: snapshot.contact, email: snapshot.email, phone: snapshot.phone
  };
  const bidders = groupBidders(snapshot.biddingCompanies);
  const equipment = snapshot.equipment || [];

  return (
    <>
      <div className="project-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h4 className="field-label" style={{ margin: 0 }}>Bid Summary</h4>
          {snapshot.pipelineDeleted ? (
            <span className="private-note-hint" style={{ margin: 0 }}>The original pipeline entry was deleted</span>
          ) : (
            <a className="link-muted" href={`/dashboard/pipeline/${snapshot.pipelineId || snapshot.id}`}>Open original pipeline entry →</a>
          )}
        </div>
        <p className="private-note-hint" style={{ marginTop: 4 }}>
          {isLive
            ? "Shown from the original pipeline entry (this project was converted before bid history was saved)."
            : `Saved when the project was created from the pipeline on ${String(snapshot.snapshotAt || "").slice(0, 10)}.`}
        </p>
        <Row label="Opportunity" value={snapshot.title} />
        <Row label="Final stage" value={snapshot.stage} />
        <Row label="Building sector" value={snapshot.buildingSector} />
        <Row label="Bid date" value={snapshot.bidDate} />
        <Row label="Estimated value" value={snapshot.value} />
        <Row label="Project address" value={snapshot.projectAddress} />
        <Row label="Outcome" value={snapshot.outcome ? `${snapshot.outcome}${snapshot.wonByContractor ? ` — awarded to ${snapshot.wonByContractor}` : ""}` : null} />
        <Row label="Resolved" value={String(snapshot.resolvedAt || "").slice(0, 10)} />
        <Row label="Entry created" value={String(snapshot.createdAt || "").slice(0, 10)} />
      </div>

      <div className="project-section">
        <h4 className="field-label">Engineering Firm</h4>
        <Row label="Firm" value={ef.company} />
        <Row label="Contact" value={ef.contact} />
        <Row label="Email" value={ef.email} />
        <Row label="Phone" value={formatPhone(ef.phone)} />
      </div>

      <div className="project-section">
        <h4 className="field-label">Bid Team</h4>
        <Row label="Pipeline owner" value={snapshot.ownerId ? personLabel(snapshot.ownerId) : null} />
        <Row label="Salesperson" value={snapshot.salespersonId ? personLabel(snapshot.salespersonId) : "Unassigned"} />
        <Row label="Project point person" value={snapshot.projectPointPersonId ? personLabel(snapshot.projectPointPersonId) : "Unassigned"} />
      </div>

      <div className="project-section">
        <h4 className="field-label">Contractors & Owners Bidding ({bidders.length})</h4>
        {bidders.length === 0 && <p className="private-note-hint">No bidders were recorded.</p>}
        {bidders.map((b, i) => {
          const isWinner = snapshot.wonByContractor && (b.company || "").toLowerCase() === snapshot.wonByContractor.toLowerCase();
          return (
            <div key={i} className="notes-history-item">
              <div>
                <strong>{b.company || "—"}</strong>
                {isWinner && <span className="role-badge role-badge-admin" style={{ marginLeft: 8 }}>Won</span>}
              </div>
              <div className="notes-history-date">
                {[firmTypeOf(b.category), b.salespersonId && `Salesperson: ${personLabel(b.salespersonId)}`].filter(Boolean).join(" | ")}
              </div>
              {contactsOf(b).length > 0 && (
                <ul className="bidder-people-list">
                  {contactsOf(b).map((c, ci) => (
                    <li key={ci}>
                      <span>{c.name || "Unnamed contact"}</span>
                      {(c.email || c.phone) && <span className="notes-history-date"> — {[c.email, formatPhone(c.phone)].filter(Boolean).join(" | ")}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="project-section">
        <h4 className="field-label">Equipment Quoted</h4>
        {equipment.length === 0 && !snapshot.towerManufacturer && !snapshot.modelNumber && (
          <p className="private-note-hint">No equipment was recorded.</p>
        )}
        {equipment.map((e, i) => (
          <p key={i}>{[e.manufacturer, e.model].filter(Boolean).join(" — ") || "—"}</p>
        ))}
        {equipment.length === 0 && (snapshot.towerManufacturer || snapshot.modelNumber) && (
          <p>{[snapshot.towerManufacturer, snapshot.modelNumber, snapshot.serialNumber && `Serial ${snapshot.serialNumber}`].filter(Boolean).join(" — ")}</p>
        )}
      </div>

      <div className="project-section">
        <h4 className="field-label">Bid Files (PDF)</h4>
        {!canSeePrivate && <p className="private-note-hint">🔒 Bid files are private to the project owner and their collaborators.</p>}
        {canSeePrivate && (bidFiles || []).length === 0 && <p className="private-note-hint">No files were uploaded to the pipeline entry.</p>}
        {canSeePrivate && (bidFiles || []).map((f, i) => (
          <div key={i} className="notes-history-item">
            <a className="link-muted" href={f.url} target="_blank" rel="noopener noreferrer">{f.name}</a>
            <div className="notes-history-date">{formatBytes(f.size)} · uploaded by {f.uploadedByName} · {f.uploadedAt?.slice(0, 10)}</div>
          </div>
        ))}
        <p className="private-note-hint" style={{ marginTop: 8 }}>The bid's notes carried over into this project's Notes on the Project Details tab.</p>
      </div>
    </>
  );
}
