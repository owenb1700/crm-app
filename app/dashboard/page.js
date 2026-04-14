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

  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [notes, setNotes] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  const [selected, setSelected] = useState(null);
  const [modalNotes, setModalNotes] = useState("");

  const [completedTarget, setCompletedTarget] = useState(null);
  const [contactMethod, setContactMethod] = useState("phone");

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const col = collection(db, "customers");

  const showToast = (msg) => alert(msg);

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

  const loadCustomers = async () => {
    const snap = await getDocs(col);
    setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  // ADD (UNCHANGED LOGIC)
  const addCustomer = async () => {
    if (!company && !contact) {
      return alert("Please enter at least a company or contact name");
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
    setAddOpen(false);

    showToast("Customer added");
    loadCustomers();
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setEditData({
      company: c.company || "",
      contact: c.contact || "",
      email: c.email || "",
      phone: c.phone || "",
      nextCheckIn: formatDate(c.nextCheckIn),
      lastContact: formatDate(c.lastContact)
    });
  };

  const saveEdit = async () => {
    await updateDoc(doc(db, "customers", editingId), {
      ...editData
    });

    setEditingId(null);
    setEditData({});
    showToast("Changes saved");
    loadCustomers();
  };

  const deleteCustomer = async (id) => {
    if (!window.confirm("Delete this contact?")) return;
    await deleteDoc(doc(db, "customers", id));
    setSelected(null);
    showToast("Deleted");
    loadCustomers();
  };

  const handleFollowUp = async (c) => {
    const next = new Date();
    next.setDate(next.getDate() + 7);

    await updateDoc(doc(db, "customers", c.id), {
      nextCheckIn: adjustWeekend(next.toISOString())
    });

    showToast("Follow-up scheduled");
    loadCustomers();
  };

  const openCompletedPopup = (c) => setCompletedTarget(c);

  const confirmCompleted = async () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);

    const entry = {
      type: "completed",
      method: contactMethod,
      timestamp: new Date().toISOString()
    };

    await updateDoc(doc(db, "customers", completedTarget.id), {
      nextCheckIn: adjustWeekend(d.toISOString()),
      activityLog: [...(completedTarget.activityLog || []), entry]
    });

    setCompletedTarget(null);
    setContactMethod("phone");

    showToast("Marked completed");
    loadCustomers();
  };

  const openModal = (c, e) => {
    if (e?.target?.tagName === "BUTTON" || e?.target?.tagName === "INPUT") return;
    setSelected(c);
    setModalNotes(c.notes || "");
  };

  const saveModalNotes = async () => {
    const ref = doc(db, "customers", selected.id);

    await updateDoc(ref, {
      notes: modalNotes,
      notesHistory: selected.notesHistory || []
    });

    setSelected(null);
    setModalNotes("");
    showToast("Notes updated");
    loadCustomers();
  };

  const filteredCustomers = useMemo(() => {
    let list = [...customers].sort(
      (a, b) => getDateValue(a.nextCheckIn) - getDateValue(b.nextCheckIn)
    );

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c =>
        (c.company || "").toLowerCase().includes(q) ||
        (c.contact || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [customers, searchQuery]);

  return (
    <div style={{
      padding: 30,
      fontFamily: "Inter, Arial",
      background: "#eef2f7",
      minHeight: "100vh"
    }}>

      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 20 }}>
        CRM Dashboard
      </h1>

      {/* ADD */}
      <button
        onClick={() => setAddOpen(true)}
        style={{
          padding: "10px 14px",
          background: "#2563eb",
          color: "white",
          border: "none",
          borderRadius: 8,
          marginBottom: 15,
          cursor: "pointer"
        }}
      >
        + ADD ENTRY
      </button>

      {/* SEARCH */}
      <div style={{ marginBottom: 15 }}>
        <button onClick={() => setSearchOpen(!searchOpen)}>🔍</button>
        {searchOpen && (
          <input
            style={{ marginLeft: 10, padding: 8 }}
            placeholder="Search..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        )}
      </div>

      {/* LIST */}
      {filteredCustomers.map(c => {
        const days = diffDays(c.nextCheckIn);
        let bar = days <= 0 ? "#e74c3c" : days <= 2 ? "#f1c40f" : "transparent";

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
              boxShadow: "0 3px 10px rgba(0,0,0,0.05)",
              cursor: "pointer"
            }}
          >

            <div style={{ width: "35%" }}>
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
                  <div style={{ fontSize: 12 }}>{formatPhone(c.phone)}</div>
                </>
              )}
            </div>

            <div style={{ flex: 1, margin: "0 15px" }}>
              {c.notes}
            </div>

            <div>
              <button onClick={() => handleFollowUp(c)}>Follow Up</button>
              <button onClick={() => openCompletedPopup(c)}>Done</button>

              {editingId === c.id ? (
                <>
                  <button onClick={saveEdit}>Save</button>
                  <button onClick={() => setEditingId(null)}>Cancel</button>
                  <button onClick={() => deleteCustomer(c.id)}>Delete</button>
                </>
              ) : (
                <button onClick={() => startEdit(c)}>Edit</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
