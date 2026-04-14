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

  const showToast = (msg) => {
    setTimeout(() => alert(msg), 0);
  };

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

  const openCompletedPopup = (c) => {
    setCompletedTarget(c);
  };

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
      activityLog: [
        ...(completedTarget.activityLog || []),
        entry
      ]
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
      padding: 32,
      fontFamily: "Inter, system-ui, Arial",
      background: "#eef2f7",
      minHeight: "100vh"
    }}>

      <h1 style={{
        fontSize: 28,
        fontWeight: 700,
        marginBottom: 18
      }}>
        CRM Dashboard
      </h1>

      {/* ADD BUTTON */}
      <button
        onClick={() => setAddOpen(true)}
        style={{
          background: "#2563eb",
          color: "white",
          padding: "10px 14px",
          borderRadius: 10,
          border: "none",
          cursor: "pointer",
          marginBottom: 15,
          fontWeight: 600
        }}
      >
        + ADD ENTRY
      </button>

      {/* SEARCH */}
      <div style={{ marginBottom: 15 }}>
        <button onClick={() => setSearchOpen(!searchOpen)}>🔍</button>

        {searchOpen && (
          <input
            placeholder="Search company, contact, or phone..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              marginLeft: 10,
              padding: 8,
              borderRadius: 8,
              border: "1px solid #ccc"
            }}
          />
        )}
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
              padding: 14,
              borderRadius: 14,
              marginBottom: 10,
              display: "flex",
              justifyContent: "space-between",
              borderLeft: `6px solid ${bar}`,
              boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
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
                  <b style={{ fontSize: 15 }}>{c.company}</b>
                  <div style={{ fontSize: 13, color: "#555" }}>{c.contact}</div>
                  <div style={{ fontSize: 11, color: "#888" }}>
                    {c.email || ""} | {formatPhone(c.phone)}
                  </div>
                </>
              )}
            </div>

            <div style={{
              flex: 1,
              margin: "0 15px",
              background: "#f8fafc",
              padding: 12,
              borderRadius: 10,
              border: "1px solid #e5e7eb"
            }}>
              <div style={{ fontSize: 12 }}>{c.notes}</div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => handleFollowUp(c)}>Follow</button>
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
