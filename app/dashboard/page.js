"use client";

import { useEffect, useState } from "react";
import { db } from "../../lib/firebase";
import { collection, addDoc, getDocs } from "firebase/firestore";

export default function Dashboard() {
  const [customers, setCustomers] = useState([]);
  const [name, setName] = useState("");

  const col = collection(db, "customers");

  const load = async () => {
    const snap = await getDocs(col);
    setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    load();
  }, []);

  const addCustomer = async () => {
    await addDoc(col, {
      name,
      email: "",
      status: "Lead",
      nextCheckIn: ""
    });

    setName("");
    load();
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>CRM Dashboard</h1>

      <input
        placeholder="Customer name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button onClick={addCustomer}>Add</button>

      {customers.map(c => (
        <div key={c.id} style={{ border: "1px solid #ddd", marginTop: 10, padding: 10 }}>
          <div><b>{c.name}</b></div>
          <div>{c.email}</div>
          <div>{c.status}</div>
        </div>
      ))}
    </div>
  );
}
