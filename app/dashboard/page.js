"use client";

import { useEffect, useState } from "react";
import { db } from "../../lib/firebase";
import { collection, addDoc, getDocs } from "firebase/firestore";

export default function Dashboard() {
  const [customers, setCustomers] = useState([]);

  const [customer, setCustomer] = useState("");
  const [contact, setContact] = useState("");
  const [lastContact, setLastContact] = useState("");

  const col = collection(db, "customers");

  const addDays = (dateStr, days) => {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split("T")[0];
  };

  const loadCustomers = async () => {
    const snap = await getDocs(col);
    setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const addCustomer = async () => {
    if (!customer) return;

    // default reminder = 7 days after last contact (or today if empty)
    const baseDate = lastContact || new Date().toISOString().split("T")[0];
    const nextCheckIn = addDays(baseDate, 7);

    await addDoc(col, {
      customer,
      contact,
      lastContact: baseDate,
      nextCheckIn,
      createdAt: new Date().toISOString()
    });

    setCustomer("");
    setContact("");
    setLastContact("");

    loadCustomers();
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h1>CRM Dashboard</h1>

      {/* FORM */}
      <div style={{ marginBottom: 20, display: "flex", gap: 10 }}>
        <input
          placeholder="Customer name"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
        />

        <input
          placeholder="Contact (email/phone)"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />

        <input
          type="date"
          value={lastContact}
          onChange={(e) => setLastContact(e.target.value)}
        />

        <button onClick={addCustomer}>Add Customer</button>
      </div>

      {/* LIST */}
      {customers.map((c) => (
        <div key={c.id} style={{ border: "1px solid #ddd", padding: 10, marginBottom: 10 }}>
          <b>{c.customer}</b>
          <div>Contact: {c.contact}</div>
          <div>Last Contact: {c.lastContact}</div>
          <div><b>Next Check-In: {c.nextCheckIn}</b></div>
        </div>
      ))}
    </div>
  );
}
