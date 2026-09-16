"use client";

import MatchingSelect from "./MatchingSelect";
import { sameCompany, similarCompanyNames, samePerson, similarPersonNames } from "../../lib/companyMatch";

// Firm picker: searches every firm in the Directory (so one saved under a
// different type is still found instead of re-entered), listing firms of
// `category` first and tagging the rest with their type.
export function FirmSelect({ id, companies, category, value, onChange, placeholder, newLabel }) {
  const options = [...(companies || [])]
    .sort((a, b) => (a.category === category ? 0 : 1) - (b.category === category ? 0 : 1) || a.name.localeCompare(b.name))
    .map(c => ({ value: c.name, tag: category && c.category !== category ? c.category : undefined }));
  return (
    <MatchingSelect
      id={id}
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder || `Select or search ${(category || "company").toLowerCase()}...`}
      newLabel={newLabel || (category || "company").toLowerCase()}
      isSame={sameCompany}
      isSimilar={similarCompanyNames}
    />
  );
}

// Person picker for one firm's people.
export function PersonSelect({ id, people, value, onChange, placeholder = "Select or search contact..." }) {
  return (
    <MatchingSelect
      id={id}
      options={(people || []).map(p => p.name)}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      newLabel="contact"
      isSame={samePerson}
      isSimilar={similarPersonNames}
    />
  );
}

// People on file at a firm. Contacts are found by the firm's Directory
// record when there is one -- so everyone attached to it shows up even if
// their contact record still carries an older spelling of the firm's name --
// and by name otherwise (a firm typed in but not saved yet).
export const peopleAtFirm = (contacts, firmName, companies) => {
  const firm = (companies || []).find(c => sameCompany(c.name, firmName));
  return (contacts || []).filter(c =>
    (firm && c.companyId === firm.id) || sameCompany(c.companyName, firmName)
  );
};

export const findPerson = (people, name) => (people || []).find(p => samePerson(p.name, name)) || null;
