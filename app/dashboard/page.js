"use client";

import { useEffect, useState, useMemo } from "react";
import { db } from "../../lib/firebase";
import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  doc,
  deleteDoc
} from "firebase/firestore";

export default function Dashboard() {
  const [customers, setCustomers] = useState([]);

  // FORM (UPDATED)
  const [customer, setCustomer] = useState("");
  const [contact, setContact] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [notes, setNotes] = useState("");

  // EDIT STATE
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  const col = collection(db, "customers");

  // DATE HELPERS
  const formatDate = (date) => {
    if (!date) return "";
    if (date.seconds) {
      return new Date(date.seconds * 1000).toISOString().split("T")[0];
    }
    return date;
  };

  const getDateValue = (date) => {
    if (!date) return 0;
    if (date.seconds) return date.seconds * 1000;
    return new Date(date).getTime();
  };

  const adjustWeekend = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    if (day === 6) d.setDate(d.getDate() + 2);
    if (day === 0) d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  };

  const addDays = (dateStr, days) => {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return adjustWeekend(date);
  };

  const today = new Date().toISOString().split("T")[0];

  const todayValue = new Date().getTime();

  const diffDays = (date) =>
    (getDateValue(date) - todayValue) / (1000 * 60 * 60 * 24);

  // LOAD
  const loadCustomers = async () => {
    const snap = await getDocs(col);
    setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  // ADD (UPDATED LOGIC)
  const addCustomer = async () => {
    if (!customer || !contact || !nextDate) {
      return alert("Fill all fields");
    }

    await addDoc(col, {
      customer,
      contact,
      nextCheckIn: adjustWeekend(nextDate), // NEXT DATE FROM INPUT
      lastContact: new Date().toISOString().split("T")[0], // AUTO TODAY
      notes,
      createdAt: new Date().toISOString()
    });

    setCustomer("");
    setContact("");
    setNextDate("");
    setNotes("");

    loadCustomers();
  };

  // EDIT
  const startEdit = (c) => {
    setEditingId(c.id);
    setEditData({
      customer: c.customer || "",
      contact: c.contact || "",
      nextCheckIn: formatDate(c.nextCheckIn),
      lastContact: formatDate(c.lastContact),
      notes: c.notes || ""
    });
  };

  const saveEdit = async () => {
    await updateDoc(doc(db, "customers", editingId), editData);
    setEditingId(null);
    setEditData({});
    loadCustomers();
  };

  const deleteCustomer = async (id) => {
    if (!window.confirm("Delete this customer?")) return;
    await deleteDoc(doc(db, "customers", id));
    setEditingId(null);
    loadCustomers();
  };

  // ACTIONS
  const handleFollowUp = async (c) => {
    const next = addDays(new Date(), 7);
    await updateDoc(doc(db, "customers", c.id), {
      nextCheckIn: next
    });
    loadCustomers();
  };

  const handleCompleted = async (c) => {
    const date = new Date();
    date.setMonth(date.getMonth() + 6);
    const adjusted = adjustWeekend(date);

    await updateDoc(doc(db, "customers", c.id), {
      nextCheckIn: adjusted
    });

    loadCustomers();
  };

  // FILTER
  const filteredCustomers = useMemo(() => {
    return [...customers].sort(
      (a, b) => getDateValue(a.nextCheckIn) - getDateValue(b.nextCheckIn)
    );
  }, [customers]);

  return (
    <div style={{
      padding: 30,
      fontFamily: "Inter, Segoe UI, Arial",
      background: "#d9dde3",
      minHeight: "100vh"
    }}>

      <h1 style={{ marginBottom: 20 }}>CRM Dashboard</h1>

      {/* ===================== */}
      {/* FORM (IMPROVED UI) */}
      {/* ===================== */}
      <div style={{
        background: "white",
        padding: 22,
        borderRadius: 12,
        marginBottom: 20,
        boxShadow: "0 2px 10px rgba(0,0,0,0.06)"
      }}>

        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12
        }}>
          <div>
            <label>Customer</label>
            <input
              style={{ width: "100%" }}
              value={customer}
              onChange={e => setCustomer(e.target.value)}
            />
          </div>

          <div>
            <label>Contact</label>
            <input
              style={{ width: "100%" }}
              value={contact}
              onChange={e => setContact(e.target.value)}
            />
          </div>

          <div>
            <label>Next Follow-Up Date</label>
            <input
              type="date"
              style={{ width: "100%" }}
              value={nextDate}
              onChange={e => setNextDate(e.target.value)}
            />
          </div>

          <div>
            <label>Notes</label>
            <input
              style={{ width: "100%" }}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        <button style={{ marginTop: 12 }} onClick={addCustomer}>
          Add Customer
        </button>
      </div>

      {/* ===================== */}
      {/* LIST */}
      {/* ===================== */}
      <div>
        {filteredCustomers.map(c => {
          const days = diffDays(c.nextCheckIn);

          let barColor = "transparent";
          if (days <= 0) barColor = "#e74c3c";
          else if (days <= 2) barColor = "#f1c40f";

          return (
            <div key={c.id} style={{
              background: "white",
              borderRadius: 12,
              marginBottom: 12,
              padding: 16,
              display: "flex",
              justifyContent: "space-between",
              boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
              borderLeft: `6px solid ${barColor}`
            }}>

              {/* LEFT */}
              <div style={{ width: "25%" }}>
                {editingId === c.id ? (
                  <>
                    <input
                      style={{ width: "100%", marginBottom: 6 }}
                      value={editData.customer}
                      onChange={e => setEditData({ ...editData, customer: e.target.value })}
                    />
                    <input
                      style={{ width: "100%", marginBottom: 6 }}
                      value={editData.contact}
                      onChange={e => setEditData({ ...editData, contact: e.target.value })}
                    />
                    <input
                      type="date"
                      style={{ width: "100%", marginBottom: 6 }}
                      value={editData.nextCheckIn}
                      onChange={e => setEditData({ ...editData, nextCheckIn: e.target.value })}
                    />
                    <input
                      type="date"
                      style={{ width: "100%" }}
                      value={editData.lastContact}
                      onChange={e => setEditData({ ...editData, lastContact: e.target.value })}
                    />
                  </>
                ) : (
                  <>
                    <b>{c.customer}</b>
                    <div style={{ color: "#555" }}>{c.contact}</div>

                    <div style={{ fontSize: 12, marginTop: 6 }}>
                      Next: {formatDate(c.nextCheckIn)}
                    </div>

                    <div style={{ fontSize: 12 }}>
                      Last Contacted: {formatDate(c.lastContact)}
                    </div>
                  </>
                )}
              </div>

              {/* MIDDLE */}
              <div style={{
                flex: 1,
                margin: "0 15px",
                background: "#f4f6f8",
                borderRadius: 8,
                padding: 10,
                fontSize: 13
              }}>
                {editingId === c.id ? (
                  <textarea
                    style={{ width: "100%", height: 70 }}
                    value={editData.notes}
                    onChange={e => setEditData({ ...editData, notes: e.target.value })}
                  />
                ) : (
                  c.notes || "No notes"
                )}
              </div>

              {/* RIGHT */}
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>

                {editingId === c.id ? (
                  <>
                    <button onClick={saveEdit}>Save</button>
                    <button onClick={() => setEditingId(null)}>Cancel</button>
                    <button
                      onClick={() => deleteCustomer(c.id)}
                      style={{ color: "red" }}
                    >
                      Delete
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
                      <label>
                        <input type="checkbox" onChange={() => handleFollowUp(c)} />
                        Follow Up
                      </label>
                      <label>
                        <input type="checkbox" onChange={() => handleCompleted(c)} />
                        Completed
                      </label>
                    </div>

                    <button onClick={() => startEdit(c)}>Edit</button>
                  </>
                )}
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}
