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

  // FORM
  const [customer, setCustomer] = useState("");
  const [contact, setContact] = useState("");
  const [lastContact, setLastContact] = useState("");
  const [notes, setNotes] = useState("");

  // EDIT STATE
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  // UI CONTROLS
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("nextCheckIn");
  const [view, setView] = useState("all");

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

  const todayValue = new Date().getTime();

  // LOAD
  const loadCustomers = async () => {
    const snap = await getDocs(col);
    setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  // ADD
  const addCustomer = async () => {
    if (!customer || !contact || !lastContact) return alert("Fill all fields");

    const nextCheckIn = addDays(lastContact, 7);

    await addDoc(col, {
      customer,
      contact,
      lastContact,
      nextCheckIn,
      notes,
      createdAt: new Date().toISOString()
    });

    setCustomer("");
    setContact("");
    setLastContact("");
    setNotes("");

    loadCustomers();
  };

  // EDIT
  const startEdit = (c) => {
    setEditingId(c.id);
    setEditData({
      customer: c.customer || "",
      contact: c.contact || "",
      lastContact: formatDate(c.lastContact),
      nextCheckIn: formatDate(c.nextCheckIn),
      notes: c.notes || ""
    });
  };

  const saveEdit = async () => {
    const ref = doc(db, "customers", editingId);
    await updateDoc(ref, editData);
    setEditingId(null);
    setEditData({});
    loadCustomers();
  };

  const deleteCustomer = async (id) => {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this customer?"
    );
    if (!confirmDelete) return;

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
    let data = [...customers];

    if (search) {
      data = data.filter(c =>
        (c.customer || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.contact || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.notes || "").toLowerCase().includes(search.toLowerCase())
      );
    }

    data.sort((a, b) =>
      getDateValue(a.nextCheckIn) - getDateValue(b.nextCheckIn)
    );

    return data;
  }, [customers, search]);

  return (
    <div style={{
      padding: 30,
      fontFamily: "Inter, Segoe UI, Arial",
      background: "#eef0f3",
      minHeight: "100vh"
    }}>

      {/* HEADER */}
      <div style={{ marginBottom: 25 }}>
        <h1 style={{ margin: 0 }}>CRM Dashboard</h1>
        <p style={{ color: "#666" }}>Clean customer follow-up system</p>
      </div>

      {/* ADD FORM */}
      <div style={{
        background: "white",
        padding: 20,
        borderRadius: 10,
        marginBottom: 20,
        boxShadow: "0 2px 10px rgba(0,0,0,0.05)"
      }}>
        <input placeholder="Customer" value={customer} onChange={e => setCustomer(e.target.value)} />
        <input placeholder="Contact" value={contact} onChange={e => setContact(e.target.value)} />
        <input type="date" value={lastContact} onChange={e => setLastContact(e.target.value)} />
        <input placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
        <button onClick={addCustomer}>Add Customer</button>
      </div>

      {/* SEARCH */}
      <input
        placeholder="Search customers..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 20 }}
      />

      {/* CARDS */}
      <div>
        {filteredCustomers.map((c) => {
          const isDue = getDateValue(c.nextCheckIn) <= todayValue;

          return (
            <div key={c.id} style={{
              background: "white",
              borderRadius: 12,
              padding: 18,
              marginBottom: 12,
              display: "flex",
              justifyContent: "space-between",
              boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
              borderLeft: isDue ? "5px solid #e74c3c" : "5px solid transparent"
            }}>

              {/* LEFT: INFO */}
              <div style={{ width: "25%" }}>
                <b style={{ fontSize: 16 }}>{c.customer}</b>
                <div style={{ color: "#555" }}>{c.contact}</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  Last: {formatDate(c.lastContact)}
                </div>
                <div style={{ fontSize: 12 }}>
                  Next: {formatDate(c.nextCheckIn)} {isDue && "🔔"}
                </div>
              </div>

              {/* MIDDLE: NOTES */}
              <div style={{
                flex: 1,
                margin: "0 15px",
                background: "#f7f8fa",
                padding: 10,
                borderRadius: 8,
                fontSize: 13,
                color: "#444"
              }}>
                {c.notes || "No notes"}
              </div>

              {/* RIGHT: ACTIONS */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 10
              }}>

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
                    {/* CHECKBOXES */}
                    <div style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
                      <label>
                        <input type="checkbox" onChange={() => handleFollowUp(c)} />
                        Follow
                      </label>
                      <label>
                        <input type="checkbox" onChange={() => handleCompleted(c)} />
                        Done
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
