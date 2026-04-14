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

  const [addOpen, setAddOpen] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  const [selected, setSelected] = useState(null);
  const [modalNotes, setModalNotes] = useState("");

  const [completedTarget, setCompletedTarget] = useState(null);
  const [contactMethod, setContactMethod] = useState("phone");

  const [toast, setToast] = useState("");

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const col = collection(db, "customers");

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 5000);
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

  // ✅ UPDATED ADD (only require company OR contact)
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

  const closeModal = () => setSelected(null);

  const saveModalNotes = async () => {
    const original = selected.notes || "";
    const changed = original !== modalNotes;

    const ref = doc(db, "customers", selected.id);

    const newHistory = changed
      ? [
          ...(selected.notesHistory || []),
          { text: original, date: new Date().toISOString() }
        ]
      : selected.notesHistory || [];

    await updateDoc(ref, {
      notes: modalNotes,
      notesHistory: newHistory
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
      background: "#cfd5dd",
      minHeight: "100vh"
    }}>

      <h1>CRM Dashboard</h1>

      <div style={{ marginBottom: 20 }}>
        <button onClick={() => setAddOpen(true)}>+ ADD ENTRY</button>
      </div>

      {/* ADD MODAL */}
      {addOpen && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center"
        }}>
          <div style={{ background: "white", padding: 20, borderRadius: 12, width: 400 }}>
            <button onClick={() => setAddOpen(false)} style={{ float: "right" }}>✕</button>

            <h3>Add Customer</h3>

            <input placeholder="Company" value={company} onChange={e => setCompany(e.target.value)} />
            <input placeholder="Contact" value={contact} onChange={e => setContact(e.target.value)} />
            <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            <input placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
            <input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} />

            {/* ✅ LARGER NOTES FIELD */}
            <textarea
              placeholder="Notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              style={{ width: "100%", height: 120 }}
            />

            <button onClick={addCustomer}>Add</button>
          </div>
        </div>
      )}

      {/* rest unchanged */}
    </div>
  );
}
