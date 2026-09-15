"use client";

// Which of our people owns the relationship with a firm: required on a
// pipeline bidder row, optional (`optional`) as a firm's assigned salesperson.
export default function SalespersonSelect({ id, users, value, onChange, label = "Salesperson", optional = false }) {
  const name = (u) => (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email);
  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <select id={id} className={`field ${value || optional ? "" : "field-needs-value"}`} value={value || ""} onChange={e => onChange(e.target.value)}>
        <option value="">{optional ? "None" : "Select salesperson..."}</option>
        {users
          .filter(u => !u.disabled || u.id === value)
          .sort((a, b) => name(a).localeCompare(name(b)))
          .map(u => <option key={u.id} value={u.id}>{name(u)}</option>)}
      </select>
    </div>
  );
}
