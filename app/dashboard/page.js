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

  // SEARCH
  const [search, setSearch] = useState("");

  // ADD MODAL
  const [addOpen, setAddOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    company: "",
    contact: "",
    email: "",
    phone: "",
    nextDate: "",
    notes: ""
  });

  // EDIT
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  // MODAL
  const [selected, setSelected] = useState(null);
  const [modalNotes, setModalNotes] = useState("");

  // COMPLETED
  const [completedTarget, setCompletedTarget] = useState(null);
  const [contactMethod, setContactMethod] = useState("phone");

  // TOAST
  const [toast, setToast] = useState("");

  const col = collection(db, "customers");

  // =====================
  // TOAST
  // =====================
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 5000);
  };

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

  const diffDays = (date) =>
    (getDateValue(date) - Date.now()) / (1000 * 60 * 60 * 24);

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
  // ADD CUSTOMER
  // =====================
  const submitNewCustomer = async () => {
    if (!newCustomer.company || !newCustomer.contact || !newCustomer.nextDate) return;

    await addDoc(col, {
      ...newCustomer,
      nextCheckIn: adjustWeekend(newCustomer.nextDate),
      lastContact: new Date().toISOString().split("T")[0],
      notesHistory: [],
      activityLog: [],
      createdAt: new Date().toISOString()
    });

    setAddOpen(false);
    setNewCustomer({
      company: "",
      contact: "",
      email: "",
      phone: "",
      nextDate: "",
      notes: ""
    });

    showToast("Customer added");
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
    showToast("Saved");
    loadCustomers();
  };

  const deleteCustomer = async (id) => {
    if (!confirm("Delete contact?")) return;
    await deleteDoc(doc(db, "customers", id));
    loadCustomers();
  };

  // =====================
  // FOLLOW UP (FIXED RESET BEHAVIOR)
  // =====================
  const handleFollowUp = async (c) => {
    const next = new Date();
    next.setDate(next.getDate() + 7);

    await updateDoc(doc(db, "customers", c.id), {
      nextCheckIn: adjustWeekend(next.toISOString())
    });

    showToast("Follow-up set");

    // IMPORTANT: force UI reset (checkbox visually clears via re-render)
    loadCustomers();
  };

  // =====================
  // COMPLETED
  // =====================
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
    showToast("Completed logged");
    loadCustomers();
  };

  // =====================
  // SEARCH FILTER
  // =====================
  const filtered = useMemo(() => {
    if (!search) return customers;

    return customers.filter(c =>
      (c.company || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.contact || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.email || "").toLowerCase().includes(search.toLowerCase())
    );
  }, [customers, search]);

  // =====================
  // UI
  // =====================
  return (
    <div style={{ padding: 30, background: "#cfd5dd", minHeight: "100vh" }}>

      {/* TOP BAR */}
      <div style={{ display: "flex", gap: 10, marginBottom: 15 }}>
        <input
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />

        <button onClick={() => setAddOpen(true)}>+ Add Customer</button>
      </div>

      {/* LIST */}
      {filtered.map(c => {
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
              marginBottom: 10,
              borderRadius: 10,
              borderLeft: `6px solid ${bar}`,
              display: "flex",
              justifyContent: "space-between"
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

                  <div>
                    <div style={{ fontSize: 10 }}>Next Date</div>
                    <input
                      type="date"
                      value={editData.nextCheckIn}
                      onChange={e => setEditData({ ...editData, nextCheckIn: e.target.value })}
                    />
                  </div>

                  <div>
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
                  <div style={{ fontSize: 18, fontWeight: 600 }}>
                    {c.company}
                  </div>

                  <div style={{ fontSize: 14 }}>
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

            {/* MIDDLE */}
            <div style={{ flex: 1, margin: "0 15px", background: "#f4f5f7", padding: 10 }}>
              {c.notes}
            </div>

            {/* RIGHT */}
            <div>
              <label>
                <input type="checkbox" onChange={() => handleFollowUp(c)} />
                Follow Up
              </label>

              <label>
                <input type="checkbox" onChange={() => setCompletedTarget(c)} />
                Completed
              </label>

              <button onClick={() => startEdit(c)}>Edit</button>
              <button onClick={() => deleteCustomer(c.id)}>Delete</button>
            </div>

          </div>
        );
      })}

      {/* ADD MODAL */}
      {addOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }}>
          <div style={{ background: "white", padding: 20, width: 400, margin: "10% auto" }}>
            <button onClick={() => setAddOpen(false)}>X</button>

            <input placeholder="Company" onChange={e => setNewCustomer({ ...newCustomer, company: e.target.value })} />
            <input placeholder="Contact" onChange={e => setNewCustomer({ ...newCustomer, contact: e.target.value })} />
            <input placeholder="Email" onChange={e => setNewCustomer({ ...newCustomer, email: e.target.value })} />
            <input placeholder="Phone" onChange={e => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
            <input type="date" onChange={e => setNewCustomer({ ...newCustomer, nextDate: e.target.value })} />
            <input placeholder="Notes" onChange={e => setNewCustomer({ ...newCustomer, notes: e.target.value })} />

            <button onClick={submitNewCustomer}>+ COMPLETED</button>
          </div>
        </div>
      )}

      {/* COMPLETED POPUP */}
      {completedTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }}>
          <div style={{ background: "white", padding: 20 }}>
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
