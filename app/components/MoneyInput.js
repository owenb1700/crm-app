"use client";

// Any box that takes a dollar amount. The $ sits inside the field on the
// left so nobody types one -- the value itself is still free text
// ("1.2M", "450k", "TBD" all still work, and lib/analytics.js parses them).
export default function MoneyInput({ id, name, value, onChange, placeholder = "e.g. 1,250,000", ...rest }) {
  return (
    <div className="money-field">
      <span className="money-prefix" aria-hidden="true">$</span>
      <input
        id={id}
        name={name}
        className="field money-input"
        autoComplete="off"
        inputMode="decimal"
        placeholder={placeholder}
        value={value ?? ""}
        onChange={e => onChange(e.target.value)}
        {...rest}
      />
    </div>
  );
}
