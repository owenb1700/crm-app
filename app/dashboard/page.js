"use client";

import { useEffect, useState } from "react";
import { db } from "../../lib/firebase";
import { collection, addDoc, getDocs } from "firebase/firestore";

export default function Dashboard() {
  const [customers, setCustomers] = useState([]);

  const [customer, setCustomer] = useState("");
  const [contact, setContact] = useState("");
  const [nextCheckIn, setNextCheckIn] = useState("");

  const col = collection(db, "customers");

  const loadCustomers = async () => {
    const snap = await getDocs(col);
    setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const addCustomer = async () => {
    if (!customer) return;

    await addDoc(col, {
      customer,
      contact,
      nextCheckIn,
      createdAt: new Date().toISOString()
    });

    setCustomer("");
    setContact("");
    setNextCheckIn("");

    loadCustomers();
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h1>CRM Dashboard</h1>

      {/* INPUT FORM */}
      <div style={{ marginBottom: 20, display: "flex", gap: 10 }}>
        <input
          placeholder="Customer name"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
        />

        <input
          placeholder="Contact info (email/phone)"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />

        <input
          type="date"
          value={nextCheckIn}
          onChange={(e) => setNextCheckIn(e.target.value)}
        />

        <button onClick={addCustomer}>Add</button>
      </div>

      {/* LIST */}
      {customers.map((c) => (
        <div key={c.id} style={{ border: "1px solid #ddd", padding: 10, marginBottom: 10 }}>
          <b>{c.customer}</b>
          <div>Contact: {c.contact}</div>
          <div>Next Check-In: {c.nextCheckIn}</div>
        </div>
      ))}
    </div>
  );
}
