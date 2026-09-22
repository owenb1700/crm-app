"use client";

import RecordNotes from "./RecordNotes";

// The notes thread in a popup, for reading and adding without leaving the
// list you're on. Same notes as the record's own page -- one thread, not a
// second place they can live.
export default function NotesModal({
  title, subtitle, collectionName, recordId, uid, myName, canAdd = true,
  legacyNotes, legacyHistory, onDeleteLegacy, onClose
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-wide" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="modal-title">{title}</h2>
        {subtitle && <p className="modal-subtitle">{subtitle}</p>}

        <h4 className="field-label">Notes</h4>
        <RecordNotes
          collectionName={collectionName}
          recordId={recordId}
          uid={uid}
          myName={myName}
          canAdd={canAdd}
          legacyNotes={legacyNotes}
          legacyHistory={legacyHistory}
          onDeleteLegacy={onDeleteLegacy}
        />
      </div>
    </div>
  );
}
