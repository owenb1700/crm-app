"use client";

import { useEffect, useState, useMemo } from "react";
import { db } from "../../lib/firebase";
import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc
} from "firebase/firestore";

export default function Dashboard() {
  const [customers, setCustomers] = useState([]);

  // FORM
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [notes, setNotes] = useState("");

  // INLINE EDIT
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  // MODAL
  const [selected, setSelected] = useState(null);
  const [modalNotes, setModalNotes] = useState("");

  // COMPLETED POPUP STATE
  const [completedTarget, setCompletedTarget] = useState(null);
  const [contactMethod, setContactMethod] = useState("phone");

  const col = collection(db, "customers");

  // =====================
  // DATE HELPERS
  // =====================
  const formatDate = (date) => {
    if (!date) return "";
    if (date?.seconds) return new Date(date.seconds * 1000).toISOString().split("T")[0];
    return date;
  };

  const getDateValue = (date) => {
    if (!date) return 0;
    if (date?.seconds) return date.seconds * 1000;
    return new Date(date).getTime();
  };

  const adjustWeekend = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    if (day === 6) d.setDate(d.getDate() + 2);
    if (day === 0) d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  };

  const todayValue = new Date().getTime();

  const diffDays = (date) =>
    (getDateValue(date) - todayValue) / (1000 * 60 * 60 * 24);

  // =====================
  // LOAD
  // =====================
  const loadCustomers = async () => {
    const snap = await getDocs(col);
    setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  // =====================
  // ADD
  // =====================
  const addCustomer = async () => {
    if (!company || !contact || !nextDate) {
      return alert("Please fill required fields");
    }

    await addDoc(col, {
      company,
      contact,
      email,
      phone,
      nextCheckIn: adjustWeekend(nextDate),
      lastContact: new Date().toISOString().split("T")[0],
      notes,
      notesHistory: [],
      activityLog: [],
      createdAt: new Date().toISOString()
    });

    setCompany("");
    setContact("");
    setEmail("");
    setPhone("");
    setNextDate("");
    setNotes("");

    loadCustomers();
  };

  // =====================
  // INLINE EDIT (FIXED SAVE)
  // =====================
  const startEdit = (c) => {
    setEditingId(c.id);
    setEditData({
      company: c.company || "",
      contact: c.contact || "",
      email: c.email || "",
      phone: c.phone || "",
      nextCheckIn: formatDate(c.nextCheckIn),
      lastContact: formatDate(c.lastContact),
      notes: c.notes || ""
    });
  };

  const saveEdit = async () => {
    const ref = doc(db, "customers", editingId);

    await updateDoc(ref, {
      ...editData // ✅ FIX: ensures ALL fields persist correctly
    });

    setEditingId(null);
    setEditData({});
    loadCustomers();
  };

  const deleteCustomer = async (id) => {
    if (!window.confirm("Delete this contact?")) return;
    await deleteDoc(doc(db, "customers", id));
    setSelected(null);
    loadCustomers();
  };

  // =====================
  // FOLLOW UP
  // =====================
  const handleFollowUp = async (c) => {
    const next = new Date();
    next.setDate(next.getDate() + 7);

    await updateDoc(doc(db, "customers", c.id), {
      nextCheckIn: adjustWeekend(next.toISOString())
    });

    loadCustomers();
  };

  // =====================
  // COMPLETED FLOW (NEW)
  // =====================
  const openCompletedPopup = (c) => {
    setCompletedTarget(c);
  };

  const confirmCompleted = async () => {
    if (!completedTarget) return;

    const d = new Date();
    d.setMonth(d.getMonth() + 6);

    const activityEntry = {
      type: "completed",
      method: contactMethod,
      timestamp: new Date().toISOString()
    };

    const ref = doc(db, "customers", completedTarget.id);

    await updateDoc(ref, {
      nextCheckIn: adjustWeekend(d.toISOString()),
      activityLog: [
        ...(completedTarget.activityLog || []),
        activityEntry
      ]
    });

    setCompletedTarget(null);
    setContactMethod("phone");
    loadCustomers();
  };

  // =====================
  // MODAL NOTES SAVE (WITH HISTORY)
  // =====================
  const saveModalNotes = async () => {
    const ref = doc(db, "customers", selected.id);

    const historyEntry = {
      text: selected.notes || "",
      date: new Date().toISOString()
    };

    await updateDoc(ref, {
      notes: modalNotes,
      notesHistory: [
        ...(selected.notesHistory || []),
        historyEntry
      ]
    });

    setSelected(null);
    setModalNotes("");
    loadCustomers();
  };

  // =====================
  // OPEN MODAL (ANY CLICK EXCEPT BUTTONS)
  // =====================
  const openModal = (c, e) => {
    if (e?.target?.tagName === "BUTTON" || e?.target?.tagName === "INPUT") return;

    setSelected(c);
    setModalNotes(c.notes || "");
  };

  // =====================
  // FILTER
  // =====================
  const filteredCustomers = useMemo(() => {
    return [...customers].sort(
      (a, b) => getDateValue(a.nextCheckIn) - getDateValue(b.nextCheckIn)
    );
  }, [customers]);

  // =====================
  // UI
  // =====================
  return (
    <div style={{
      padding: 30,
      fontFamily: "Inter, Arial",
      background: "#cfd5dd",
      minHeight: "100vh"
    }}>

      <h1>CRM Dashboard</h1>

      {/* FORM */}
      <div style={{
        background: "white",
        padding: 20,
        borderRadius: 12,
        marginBottom: 20
      }}>
        <input placeholder="Company" value={company} onChange={e => setCompany(e.target.value)} />
        <input placeholder="Contact" value={contact} onChange={e => setContact(e.target.value)} />
        <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
        <input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} />
        <input placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />

        <button onClick={addCustomer}>Add Company</button>
      </div>

      {/* LIST */}
      {filteredCustomers.map(c => {
        const days = diffDays(c.nextCheckIn);

        let bar = "transparent";
        if (days <= 0) bar = "#e74c3c";
        else if (days <= 2) bar = "#f1c40f";

        return (
          <div
            key={c.id}
            onClick={(e) => openModal(c, e)}
            style={{
              background: "white",
              padding: 15,
              borderRadius: 12,
              marginBottom: 10,
              display: "flex",
              justifyContent: "space-between",
              borderLeft: `6px solid ${bar}`,
              cursor: "pointer"
            }}
          >

            {/* LEFT */}
            <div style={{ width: "30%" }}>
              {editingId === c.id ? (
                <>
                  <input value={editData.company} onChange={e => setEditData({ ...editData, company: e.target.value })} />
                  <input value={editData.contact} onChange={e => setEditData({ ...editData, contact: e.target.value })} />
                  <input value={editData.email} onChange={e => setEditData({ ...editData, email: e.target.value })} />
                  <input value={editData.phone} onChange={e => setEditData({ ...editData, phone: e.target.value })} />
                  <input type="date" value={editData.nextCheckIn} onChange={e => setEditData({ ...editData, nextCheckIn: e.target.value })} />
                  <input type="date" value={editData.lastContact} onChange={e => setEditData({ ...editData, lastContact: e.target.value })} />
                </>
              ) : (
                <>
                  <b>{c.company}</b>
                  <div>{c.contact}</div>
                  <div>{c.email}</div>
                  <div>{c.phone}</div>
                  <div style={{ fontSize: 12 }}>Next: {formatDate(c.nextCheckIn)}</div>
                  <div style={{ fontSize: 12 }}>Last: {formatDate(c.lastContact)}</div>
                </>
              )}
            </div>

            {/* MIDDLE */}
            <div style={{
              flex: 1,
              margin: "0 15px",
              background: "#f3f5f7",
              padding: 10,
              borderRadius: 8
            }}>
              {c.notes}
            </div>

            {/* RIGHT */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>

              <div style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
                <label>
                  <input type="checkbox" onChange={() => handleFollowUp(c)} />
                  Follow Up
                </label>

                <label>
                  <input type="checkbox" onChange={() => openCompletedPopup(c)} />
                  Completed
                </label>
              </div>

              {editingId === c.id ? (
                <>
                  <button onClick={saveEdit}>Save</button>
                  <button onClick={() => setEditingId(null)}>Cancel</button>
                  <button onClick={() => deleteCustomer(c.id)} style={{ color: "red" }}>
                    Delete
                  </button>
                </>
              ) : (
                <button onClick={() => startEdit(c)}>Edit</button>
              )}

            </div>
          </div>
        );
      })}

      {/* COMPLETED POPUP */}
      {completedTarget && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center"
        }}>
          <div style={{ background: "white", padding: 20, borderRadius: 12 }}>
            <h3>How was this contact made?</h3>

            <select
              value={contactMethod}
              onChange={e => setContactMethod(e.target.value)}
            >
              <option value="phone">Phone</option>
              <option value="email">Email</option>
            </select>

            <div style={{ marginTop: 10 }}>
              <button onClick={confirmCompleted}>Confirm</button>
              <button onClick={() => setCompletedTarget(null)} style={{ marginLeft: 10 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NOTES HISTORY IN MODAL */}
      {selected && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center"
        }}>
          <div style={{ background: "white", width: 600, padding: 20, borderRadius: 12 }}>
            <h2>{selected.company}</h2>

            <p>{selected.contact}</p>
            <p>{selected.email}</p>
            <p>{selected.phone}</p>

            <h4>Notes</h4>
            <textarea
              style={{ width: "100%", height: 80 }}
              value={modalNotes}
              onChange={e => setModalNotes(e.target.value)}
            />

            <button onClick={saveModalNotes}>Save Notes</button>

            <h4 style={{ marginTop: 15 }}>History</h4>

            {(selected.notesHistory || []).map((h, i) => (
              <div key={i} style={{
                fontSize: 12,
                background: "#f4f6f8",
                marginTop: 5,
                padding: 6,
                borderRadius: 6
              }}>
                <div>{h.text}</div>
                <div style={{ color: "#777" }}>{h.date}</div>
              </div>
            ))}

          </div>
        </div>
      )}

    </div>
  );
}
