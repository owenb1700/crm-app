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

  // EDIT
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  // MODAL
  const [selected, setSelected] = useState(null);
  const [modalNotes, setModalNotes] = useState("");

  // COMPLETED
  const [completedTarget, setCompletedTarget] = useState(null);
  const [contactMethod, setContactMethod] = useState("phone");

  // FORCE CHECKBOX RESET (NEW)
  const [actionTick, setActionTick] = useState(0);

  const col = collection(db, "customers");

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
  // HELPERS
  // =====================
  const formatPhone = (phone) => {
    if (!phone) return "";
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) return phone;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

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
  const handleFollowUp = async (c) => {
    const next = new Date();
    next.setDate(next.getDate() + 7);

    await updateDoc(doc(db, "customers", c.id), {
      nextCheckIn: adjustWeekend(next.toISOString())
    });

    // FORCE UI RESET (checkbox unchecks)
    setActionTick(t => t + 1);

    loadCustomers();
  };

  const openCompletedPopup = (c) => {
    setCompletedTarget(c);
  };

  const confirmCompleted = async () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);

    await updateDoc(doc(db, "customers", completedTarget.id), {
      nextCheckIn: adjustWeekend(d.toISOString()),
      activityLog: [
        ...(completedTarget.activityLog || []),
        {
          type: "completed",
          method: contactMethod,
          timestamp: new Date().toISOString()
        }
      ]
    });

    setCompletedTarget(null);
    loadCustomers();
  };

  // =====================
  // EDIT
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
    await updateDoc(doc(db, "customers", editingId), {
      ...editData
    });

    setEditingId(null);
    loadCustomers();
  };

  const deleteCustomer = async (id) => {
    if (!confirm("Delete this contact?")) return;
    await deleteDoc(doc(db, "customers", id));
    loadCustomers();
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

      {/* LIST */}
      {filteredCustomers.map(c => {
        const days = diffDays(c.nextCheckIn);

        let bar = "transparent";
        if (days <= 0) bar = "#e74c3c";
        else if (days <= 2) bar = "#f1c40f";

        return (
          <div
            key={c.id}
            style={{
              background: "white",
              padding: 15,
              borderRadius: 12,
              marginBottom: 10,
              display: "flex",
              justifyContent: "space-between",
              borderLeft: `6px solid ${bar}`
            }}
          >

            {/* LEFT */}
            <div style={{ width: "35%" }}>

              {editingId === c.id ? (
                <>
                  <input value={editData.company} onChange={e => setEditData({ ...editData, company: e.target.value })} />
                  <input value={editData.contact} onChange={e => setEditData({ ...editData, contact: e.target.value })} />
                  <input value={editData.email} onChange={e => setEditData({ ...editData, email: e.target.value })} />
                  <input value={editData.phone} onChange={e => setEditData({ ...editData, phone: e.target.value })} />

                  {/* FIXED DATE ALIGNMENT */}
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 10 }}>Next Date</div>
                    <input
                      type="date"
                      value={editData.nextCheckIn}
                      onChange={e => setEditData({ ...editData, nextCheckIn: e.target.value })}
                    />
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 10 }}>Last Contact</div>
                    <input
                      type="date"
                      value={editData.lastContact}
                      onChange={e => setEditData({ ...editData, lastContact: e.target.value })}
                    />
                  </div>

                  <button onClick={saveEdit}>Save</button>
                  <button onClick={() => setEditingId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  {/* TYPOGRAPHY FIX */}
                  <div style={{ fontSize: 18, fontWeight: 600 }}>
                    {c.company}
                  </div>

                  <div style={{ fontSize: 15 }}>
                    {c.contact}
                  </div>

                  <div style={{ fontSize: 11, color: "#777" }}>
                    {c.email} | {formatPhone(c.phone)}
                  </div>

                  <div style={{ fontSize: 12 }}>Next: {formatDate(c.nextCheckIn)}</div>
                  <div style={{ fontSize: 12 }}>Last: {formatDate(c.lastContact)}</div>
                </>
              )}

            </div>

            {/* RIGHT */}
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>

              {/* FOLLOW UP (FORCED RESET KEY) */}
              <label key={"follow-" + c.id + "-" + actionTick}>
                <input type="checkbox" onChange={() => handleFollowUp(c)} />
                Follow Up
              </label>

              <label key={"done-" + c.id + "-" + actionTick}>
                <input type="checkbox" onChange={() => openCompletedPopup(c)} />
                Completed
              </label>

              <button onClick={() => startEdit(c)}>Edit</button>
              <button onClick={() => deleteCustomer(c.id)}>Delete</button>
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
            <select value={contactMethod} onChange={e => setContactMethod(e.target.value)}>
              <option value="phone">Phone</option>
              <option value="email">Email</option>
            </select>

            <button onClick={confirmCompleted}>Confirm</button>
          </div>
        </div>
      )}

    </div>
  );
}
