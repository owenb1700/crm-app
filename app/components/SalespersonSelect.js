"use client";

// Required salesperson for a pipeline bidder row: which of our people owns
// the relationship with that bidding firm.
export default function SalespersonSelect({ id, users, value, onChange, label = "Salesperson" }) {
  const name = (u) => (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email);
  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <select id={id} className={`field ${value ? "" : "field-needs-value"}`} value={value || ""} onChange={e => onChange(e.target.value)}>
        <option value="">Select salesperson...</option>
        {users
          .filter(u => !u.disabled || u.id === value)
          .sort((a, b) => name(a).localeCompare(name(b)))
          .map(u => <option key={u.id} value={u.id}>{name(u)}</option>)}
      </select>
    </div>
  );
}
