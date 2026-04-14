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
  <div style={{ 
    padding: 30, 
    fontFamily: "Segoe UI, Arial", 
    background: "#f5f7fb",
    minHeight: "100vh"
  }}>

    {/* HEADER */}
    <div style={{ marginBottom: 30 }}>
      <h1 style={{ margin: 0 }}>CRM Dashboard</h1>
      <p style={{ color: "#666" }}>Manage customers and follow-ups</p>
    </div>

    {/* VIEW SWITCH */}
    <div style={{ marginBottom: 20 }}>
      <button
        onClick={() => setView("all")}
        style={{
          padding: "8px 14px",
          borderRadius: 6,
          border: "none",
          background: view === "all" ? "#0070f3" : "#ddd",
          color: view === "all" ? "white" : "#333",
          cursor: "pointer"
        }}
      >
        All Customers
      </button>

      <button
        onClick={() => setView("due")}
        style={{
          padding: "8px 14px",
          marginLeft: 10,
          borderRadius: 6,
          border: "none",
          background: view === "due" ? "#0070f3" : "#ddd",
          color: view === "due" ? "white" : "#333",
          cursor: "pointer"
        }}
      >
        🔔 Due Today
      </button>
    </div>

    {/* FORM CARD */}
    <div style={{
      background: "white",
      padding: 20,
      borderRadius: 10,
      marginBottom: 25,
      boxShadow: "0 2px 8px rgba(0,0,0,0.05)"
    }}>
      <h3>Add Customer</h3>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          placeholder="Customer"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }}
        />

        <input
          placeholder="Contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }}
        />

        <input
          type="date"
          value={lastContact}
          onChange={(e) => setLastContact(e.target.value)}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }}
        />

        <button
          onClick={addCustomer}
          style={{
            background: "#0070f3",
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "8px 16px",
            cursor: "pointer"
          }}
        >
          Add
        </button>
      </div>
    </div>

    {/* SEARCH + SORT */}
    <div style={{
      background: "white",
      padding: 20,
      borderRadius: 10,
      marginBottom: 25,
      boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      display: "flex",
      gap: 10,
      flexWrap: "wrap"
    }}>
      <input
        placeholder="Search..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }}
      />

      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value)}
        style={{ padding: 8, borderRadius: 6 }}
      >
        <option value="nextCheckIn">Next Check-In</option>
        <option value="lastContact">Last Contact</option>
        <option value="customer">Customer A–Z</option>
      </select>
    </div>

    {/* CUSTOMER LIST */}
    <div style={{ display: "grid", gap: 15 }}>
      {filteredCustomers.map((c) => {
        const isDue = getDateValue(c.nextCheckIn) <= todayValue;

        return (
          <div
            key={c.id}
            style={{
              background: "white",
              padding: 18,
              borderRadius: 10,
              boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
              borderLeft: isDue ? "6px solid #ff4d4f" : "6px solid transparent"
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              {c.customer}
            </div>

            <div style={{ color: "#555", marginTop: 5 }}>
              {c.contact}
            </div>

            <div style={{ marginTop: 10, fontSize: 14 }}>
              Last Contact: {formatDate(c.lastContact)}
            </div>

            <div style={{ marginTop: 5, fontSize: 14 }}>
              <b>
                Next Check-In: {formatDate(c.nextCheckIn)}
                {isDue && " 🔔"}
              </b>
            </div>
          </div>
        );
      })}
    </div>

  </div>
);
}
