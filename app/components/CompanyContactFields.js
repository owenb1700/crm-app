"use client";

import { primaryEmail, primaryPhone } from "../../lib/directory";
import { FirmSelect, PersonSelect, peopleAtFirm, findPerson } from "./DirectoryPickers";

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
  // Every firm is searchable (firms of companyCategory listed first), and
  // near-duplicate names are caught -- see MatchingSelect.
  const matchingContacts = peopleAtFirm(contacts, companyValue, companies);

  // Picking a known person sets three fields in a row, so each handler must
  // update from the latest state (setState(prev => ...)) -- reading a stale
  // copy would make the last one overwrite the other two.
  const handleContactChange = (value) => {
    onContactChange(value);
    const match = findPerson(matchingContacts, value);
    if (match) {
      if (onEmailChange) onEmailChange(primaryEmail(match));
      if (onPhoneChange) onPhoneChange(primaryPhone(match));
    }
  };

  return (
    <>
      <div>
        <label className="field-label">{companyLabel}</label>
        <FirmSelect id={`${idPrefix}-company`} companies={companies} category={companyCategory} value={companyValue} onChange={onCompanyChange} />
      </div>

      <div>
        <label className="field-label">Contact</label>
        <PersonSelect id={`${idPrefix}-contact`} people={matchingContacts} value={contactValue} onChange={handleContactChange} />
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
