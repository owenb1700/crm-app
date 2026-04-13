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
  const [view, setView] = useState("all"); // 👈 NEW

  const col = collection(db, "customers");

  const addDays = (dateStr, days) => {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split("T")[0];
  };

  const today = new Date().toISOString().split("T")[0];

  const loadCustomers = async () => {
    const snap = await getDocs(col);
    setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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

  // 🔎 FILTER + SORT + VIEW LOGIC
  const filteredCustomers = useMemo(() => {
    let data = [...customers];

    // 🔔 DUE TODAY FILTER
    if (view === "due") {
      data = data.filter(c => c.nextCheckIn && c.nextCheckIn <= today);
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
        return new Date(b.lastContact || 0) - new Date(a.lastContact || 0);
      }

      if (sortBy === "nextCheckIn") {
        return new Date(a.nextCheckIn || 0) - new Date(b.nextCheckIn || 0);
      }

      return 0;
    });

    return data;
  }, [customers, search, sortBy, view, today]);

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h1>CRM Dashboard</h1>

      {/* VIEW SWITCHER */}
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
      {filteredCustomers.map((c) => (
        <div key={c.id} style={{ border: "1px solid #ddd", padding: 10, marginBottom: 10 }}>
          <b>{c.customer}</b>
          <div>Contact: {c.contact}</div>
          <div>Last Contact: {c.lastContact}</div>
          <div>
            <b>
              Next Check-In: {c.nextCheckIn}
              {c.nextCheckIn <= today && " 🔔 DUE"}
            </b>
          </div>
        </div>
      ))}
    </div>
  );
}
