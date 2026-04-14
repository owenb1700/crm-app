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

  // ======================
  // FORM STATE (NEW MODEL)
  // ======================
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [notes, setNotes] = useState("");

  // ======================
  // MODAL STATE
  // ======================
  const [selected, setSelected] = useState(null);
  const [modalEdit, setModalEdit] = useState({});
  const [modalNotes, setModalNotes] = useState("");

  // ======================
  // UI STATE
  // ======================
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const [sortBy, setSortBy] = useState("nextCheckIn");

  const col = collection(db, "customers");

  // ======================
  // DATE HELPERS
  // ======================
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

  const addDays = (dateStr, days) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return adjustWeekend(d);
  };

  const todayValue = new Date().getTime();

  const diffDays = (date) =>
    (getDateValue(date) - todayValue) / (1000 * 60 * 60 * 24);

  // ======================
  // LOAD DATA
  // ======================
  const loadCustomers = async () => {
    const snap = await getDocs(col);
    setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  // ======================
  // ADD CUSTOMER
  // ======================
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

  // ======================
  // MODAL OPEN/CLOSE
  // ======================
  const openModal = (c) => {
    setSelected(c);
    setModalEdit({
      company: c.company,
      contact: c.contact,
      email: c.email,
      phone: c.phone,
      nextCheckIn: formatDate(c.nextCheckIn),
      lastContact: formatDate(c.lastContact)
    });
    setModalNotes(c.notes || "");
  };

  const closeModal = () => {
    setSelected(null);
    setModalEdit({});
    setModalNotes("");
  };

  // ======================
  // SAVE FULL EDIT (MODAL)
  // ======================
  const saveModal = async () => {
    const ref = doc(db, "customers", selected.id);

    const newHistoryEntry = {
      text: selected.notes || "",
      date: new Date().toISOString()
    };

    await updateDoc(ref, {
      ...modalEdit,
      notes: modalNotes,
      notesHistory: [
        ...(selected.notesHistory || []),
        newHistoryEntry
      ]
    });

    closeModal();
    loadCustomers();
  };

  // ======================
  // DELETE
  // ======================
  const deleteCustomer = async (id) => {
    if (!window.confirm("Delete this contact?")) return;
    await deleteDoc(doc(db, "customers", id));
    closeModal();
    loadCustomers();
  };

  // ======================
  // FOLLOW UP / COMPLETED
  // ======================
  const handleFollowUp = async (c) => {
    const next = addDays(new Date(), 7);
    await updateDoc(doc(db, "customers", c.id), {
      nextCheckIn: next
    });
    loadCustomers();
  };

  const handleCompleted = async (c) => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    const adjusted = adjustWeekend(d);

    await updateDoc(doc(db, "customers", c.id), {
      nextCheckIn: adjusted
    });

    loadCustomers();
  };

  // ======================
  // FILTER + SORT
  // ======================
  const filteredCustomers = useMemo(() => {
    let data = [...customers];

    if (view === "due") {
      data = data.filter(c => getDateValue(c.nextCheckIn) <= todayValue);
    }

    if (search) {
      data = data.filter(c =>
        (c.company || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.contact || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.email || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.phone || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.notes || "").toLowerCase().includes(search.toLowerCase())
      );
    }

    data.sort((a, b) => {
      if (sortBy === "customer") {
        return (a.company || "").localeCompare(b.company || "");
      }
      return getDateValue(a.nextCheckIn) - getDateValue(b.nextCheckIn);
    });

    return data;
  }, [customers, search, view, sortBy]);

  // ======================
  // UI
  // ======================
  return (
    <div style={{
      padding: 30,
      fontFamily: "Inter, Arial",
      background: "#cfd5dd",
      minHeight: "100vh"
    }}>

      <h1>CRM Dashboard</h1>

      {/* ================= FORM ================= */}
      <div style={{
        background: "white",
        padding: 20,
        borderRadius: 12,
        marginBottom: 20,
        boxShadow: "0 2px 10px rgba(0,0,0,0.06)"
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input placeholder="Company" value={company} onChange={e => setCompany(e.target.value)} />
          <input placeholder="Contact" value={contact} onChange={e => setContact(e.target.value)} />
          <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
          <input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} />
          <input placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <button onClick={addCustomer} style={{ marginTop: 10 }}>
          Add Company
        </button>
      </div>

      {/* SEARCH */}
      <input
        placeholder="Search..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 15 }}
      />

      {/* LIST */}
      {filteredCustomers.map(c => {
        const days = diffDays(c.nextCheckIn);

        let bar = "transparent";
        if (days <= 0) bar = "#e74c3c";
        else if (days <= 2) bar = "#f1c40f";

        return (
          <div key={c.id}
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
            <div style={{ width: "25%" }} onClick={() => openModal(c)}>
              <b>{c.company}</b>
              <div style={{ fontSize: 13 }}>{c.contact}</div>
              <div style={{ fontSize: 12 }}>{c.email}</div>
              <div style={{ fontSize: 12 }}>{c.phone}</div>
              <div style={{ fontSize: 12 }}>
                Next: {formatDate(c.nextCheckIn)}
              </div>
              <div style={{ fontSize: 12 }}>
                Last: {formatDate(c.lastContact)}
              </div>
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
                  <input type="checkbox" onChange={() => handleCompleted(c)} />
                  Completed
                </label>
              </div>

              <button onClick={() => openModal(c)}>Open</button>
            </div>

          </div>
        );
      })}

      {/* ================= MODAL ================= */}
      {selected && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center"
        }}>
          <div style={{
            background: "white",
            width: 600,
            padding: 20,
            borderRadius: 12
          }}>

            <h2>{modalEdit.company}</h2>

            <input
              value={modalEdit.contact}
              onChange={e => setModalEdit({ ...modalEdit, contact: e.target.value })}
            />
            <input
              value={modalEdit.email}
              onChange={e => setModalEdit({ ...modalEdit, email: e.target.value })}
            />
            <input
              value={modalEdit.phone}
              onChange={e => setModalEdit({ ...modalEdit, phone: e.target.value })}
            />
            <input
              type="date"
              value={modalEdit.nextCheckIn}
              onChange={e => setModalEdit({ ...modalEdit, nextCheckIn: e.target.value })}
            />
            <input
              type="date"
              value={modalEdit.lastContact}
              onChange={e => setModalEdit({ ...modalEdit, lastContact: e.target.value })}
            />

            <h4>Notes</h4>
            <textarea
              style={{ width: "100%", height: 80 }}
              value={modalNotes}
              onChange={e => setModalNotes(e.target.value)}
            />

            <div style={{ marginTop: 10 }}>
              <button onClick={saveModal}>Save</button>
              <button onClick={closeModal}>Close</button>
              <button onClick={() => deleteCustomer(selected.id)} style={{ color: "red" }}>
                Delete
              </button>
            </div>

            {/* HISTORY */}
            <div style={{ marginTop: 15 }}>
              <h4>Notes History</h4>
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
        </div>
      )}

    </div>
  );
}
