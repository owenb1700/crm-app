"use client";

// Reusable company + contact input pair with directory-backed autocomplete.
// Typing a company shows suggestions from the shared directory; the contact
// field's suggestions narrow to people at whichever company is currently
// typed. Selecting a known person auto-fills their email/phone.
export default function CompanyContactFields({
  idPrefix,
  companies,
  contacts,
  companyLabel = "Company",
  companyCategory,
  companyValue,
  contactValue,
  emailValue,
  phoneValue,
  onCompanyChange,
  onContactChange,
  onEmailChange,
  onPhoneChange,
  showEmailPhone = true
}) {
  // Scoped to the matching Directory category (e.g. only Engineering
  // Firms suggested in an Engineering Firm field) so a Contractor never
  // shows up as a suggestion for a Customer or vice versa.
  const companyOptions = (companies || []).filter(c => !companyCategory || c.category === companyCategory);
  const matchingContacts = (contacts || []).filter(
    c => (c.companyName || "").toLowerCase() === (companyValue || "").toLowerCase()
  );

  const handleContactChange = (value) => {
    onContactChange(value);
    const match = matchingContacts.find(c => c.name.toLowerCase() === value.toLowerCase());
    if (match) {
      if (onEmailChange) onEmailChange(match.email || "");
      if (onPhoneChange) onPhoneChange(match.phone || "");
    }
  };

  return (
    <>
      <div>
        <label className="field-label">{companyLabel}</label>
        <input
          className="field"
          list={`${idPrefix}-companies`}
          autoComplete="off"
          value={companyValue}
          onChange={e => onCompanyChange(e.target.value)}
        />
        <datalist id={`${idPrefix}-companies`}>
          {companyOptions.map(c => <option key={c.id} value={c.name} />)}
        </datalist>
      </div>

      <div>
        <label className="field-label">Contact</label>
        <input
          className="field"
          list={`${idPrefix}-contacts`}
          autoComplete="off"
          value={contactValue}
          onChange={e => handleContactChange(e.target.value)}
        />
        <datalist id={`${idPrefix}-contacts`}>
          {matchingContacts.map(c => <option key={c.id} value={c.name} />)}
        </datalist>
      </div>

      {showEmailPhone && (
        <>
          <div>
            <label className="field-label">Email</label>
            <input className="field" autoComplete="off" value={emailValue} onChange={e => onEmailChange(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Phone</label>
            <input className="field" autoComplete="off" value={phoneValue} onChange={e => onPhoneChange(e.target.value)} />
          </div>
        </>
      )}
    </>
  );
}
