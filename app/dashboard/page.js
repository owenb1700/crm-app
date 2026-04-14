"use client";

import { useEffect, useState, useMemo } from "react";
import { db } from "../../lib/firebase";
import { collection, addDoc, getDocs } from "firebase/firestore";

export default function Dashboard() {
  const [customers, setCustomers] = useState([]);

  // FORM
  const [customer, setCustomer] = useState("");
  const [contact, setContact] = useState("");
  const [lastContact, setLastContact] = useState("");

  // UI CONTROLS
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("nextCheckIn");
  const [view, setView] = useState("all");

  const col = collection(db, "customers");

  // ✅ FORMAT FIREBASE DATES SAFELY (FIXES YOUR CRASH)
  const formatDate = (date) => {
    if (!date) return "";

    if (date.seconds) {
      return new Date(date.seconds * 1000).toISOString().split("T")[0];
    }

    return date;
  };

  // ✅ SAFE DATE FOR SORTING / FILTERING
  const getDateValue = (date) => {
    if (!date) return 0;

    if (date.seconds) {
      return date.seconds * 1000;
    }

    return new Date(date).getTime();
  };

  const addDays = (dateStr, days) => {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split("T")[0];
  };

  const today = new Date().toISOString().split("T")[0];
  const todayValue = new Date(today).getTime();

  // ✅ SAFE LOAD (prevents crashes)
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
      createdAt: new Date().toISOString()
    });

    setCustomer("");
    setContact("");
    setLastContact("");

    loadCustomers();
  };

  // 🔎 FILTER + SORT + VIEW
  const filteredCustomers = useMemo(() => {
    let data = [...customers];

    // 🔔 DUE TODAY
    if (view === "due") {
      data = data.filter(c => getDateValue(c.nextCheckIn) <= todayValue);
    }

    // SEARCH
    if (search) {
      data = data.filter(c =>
        (c.customer || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.contact || "").toLowerCase().includes(search.toLowerCase())
      );
    }

    // SORT
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
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h1>CRM Dashboard</h1>

      {/* VIEW SWITCH */}
      <div style={{ marginBottom: 10 }}>
        <button onClick={() => setView("all")}>All Customers</button>
        <button onClick={() => setView("due")} style={{ marginLeft: 10 }}>
          🔔 Due Today
        </button>
      </div>

      {/* FORM */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          placeholder="Customer"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
        />

        <input
          placeholder="Contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />

        <input
          type="date"
          value={lastContact}
          onChange={(e) => setLastContact(e.target.value)}
        />

        <button onClick={addCustomer}>Add</button>
      </div>

      {/* SEARCH + SORT */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="nextCheckIn">Sort: Next Check-In</option>
          <option value="lastContact">Sort: Last Contact</option>
          <option value="customer">Sort: A–Z</option>
        </select>
      </div>

      {/* LIST */}
      {filteredCustomers.map((c) => {
        const isDue = getDateValue(c.nextCheckIn) <= todayValue;

        return (
          <div
            key={c.id}
            style={{
              border: "1px solid #ddd",
              padding: 10,
              marginBottom: 10,
              background: isDue ? "#fff3cd" : "white"
            }}
          >
            <b>{c.customer}</b>
            <div>Contact: {c.contact}</div>
            <div>Last Contact: {formatDate(c.lastContact)}</div>
            <div>
              <b>
                Next Check-In: {formatDate(c.nextCheckIn)}
                {isDue && " 🔔 DUE"}
              </b>
            </div>
          </div>
        );
      })}
    </div>
  );
}
