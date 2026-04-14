"use client";

import { useEffect, useState, useMemo } from "react";
import { db } from "../../lib/firebase";
import { collection, addDoc, getDocs, updateDoc, doc } from "firebase/firestore";

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

  // FORMAT DATE
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

  const addDays = (dateStr, days) => {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split("T")[0];
  };

  const today = new Date().toISOString().split("T")[0];
  const todayValue = new Date(today).getTime();

  // LOAD
  const loadCustomers = async () => {
    try {
      const snap = await getDocs(col);
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("Firestore error:", err);
      setCustomers([]);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  // ADD
  const addCustomer = async () => {
    if (!customer || !contact || !lastContact) {
      alert("Please fill all fields");
      return;
    }

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
    try {
      const ref = doc(db, "customers", editingId);
      await updateDoc(ref, editData);

      setEditingId(null);
      setEditData({});
      loadCustomers();
    } catch (err) {
      console.error(err);
      alert("Error saving changes");
    }
  };

  // FILTER / SORT
  const filteredCustomers = useMemo(() => {
    let data = [...customers];

    if (view === "due") {
      data = data.filter(c => getDateValue(c.nextCheckIn) <= todayValue);
    }

    if (search) {
      data = data.filter(c =>
        (c.customer || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.contact || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.notes || "").toLowerCase().includes(search.toLowerCase())
      );
    }

    data.sort((a, b) => {
      if (sortBy === "customer") {
        return (a.customer || "").localeCompare(b.customer || "");
      }

      if (sortBy === "lastContact") {
        return getDateValue(b.lastContact) - getDateValue(a.lastContact);
      }

      if (sortBy === "nextCheckIn") {
        return getDateValue(a.nextCheckIn) - getDateValue(b.nextCheckIn);
      }

      return 0;
    });

    return data;
  }, [customers, search, sortBy, view, todayValue]);

  return (
    <div style={{ padding: 30, fontFamily: "Segoe UI, Arial", background: "#f5f7fb", minHeight: "100vh" }}>

      {/* HEADER */}
      <div style={{ marginBottom: 30 }}>
        <h1 style={{ margin: 0 }}>CRM Dashboard</h1>
        <p style={{ color: "#666" }}>Manage customers and follow-ups</p>
      </div>

      {/* VIEW SWITCH */}
      <div style={{ marginBottom: 20 }}>
        <button onClick={() => setView("all")}>All Customers</button>
        <button onClick={() => setView("due")} style={{ marginLeft: 10 }}>
          🔔 Due Today
        </button>
      </div>

      {/* FORM */}
      <div style={{ background: "white", padding: 20, marginBottom: 25 }}>
        <input placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
        <input placeholder="Contact" value={contact} onChange={(e) => setContact(e.target.value)} />
        <input type="date" value={lastContact} onChange={(e) => setLastContact(e.target.value)} />
        <input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button onClick={addCustomer}>Add</button>
      </div>

      {/* SEARCH */}
      <input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />

      {/* LIST */}
      <div style={{ marginTop: 20 }}>
        {filteredCustomers.map((c) => {
          const isDue = getDateValue(c.nextCheckIn) <= todayValue;

          return (
            <div key={c.id} style={{
              background: "white",
              padding: 15,
              marginBottom: 10,
              borderLeft: isDue ? "5px solid red" : "5px solid transparent",
              position: "relative"
            }}>
              {editingId === c.id ? (
                <>
                  <input value={editData.customer} onChange={e => setEditData({ ...editData, customer: e.target.value })} />
                  <input value={editData.contact} onChange={e => setEditData({ ...editData, contact: e.target.value })} />
                  <input type="date" value={editData.lastContact} onChange={e => setEditData({ ...editData, lastContact: e.target.value })} />
                  <input type="date" value={editData.nextCheckIn} onChange={e => setEditData({ ...editData, nextCheckIn: e.target.value })} />
                  <textarea value={editData.notes} onChange={e => setEditData({ ...editData, notes: e.target.value })} />
                  <button onClick={saveEdit}>Save</button>
                  <button onClick={() => setEditingId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <b>{c.customer}</b>
                  <div>{c.contact}</div>
                  <div>Last: {formatDate(c.lastContact)}</div>
                  <div>
                    Next: {formatDate(c.nextCheckIn)} {isDue && "🔔"}
                  </div>
                  {c.notes && <div>📝 {c.notes}</div>}

                  <button
                    onClick={() => startEdit(c)}
                    style={{ position: "absolute", top: 10, right: 10 }}
                  >
                    Edit
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
