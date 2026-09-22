"use client";

import { COMPANY_CATEGORIES } from "../../lib/directory";
import { PART_STAGES, blankContractor } from "../../lib/parts";
import { FirmSelect, PersonSelect, peopleAtFirm, findPerson } from "./DirectoryPickers";
import MoneyInput from "./MoneyInput";
import AddressAutocomplete from "./AddressAutocomplete";

// The fields of a parts request, shared by the Add box on the Parts list
// and the Edit form on a request's own page, so the two can't drift.
export default function PartForm({ values, setValues, idPrefix, companies = [], contacts = [] }) {
  // Picking a person at the firm fills in their email and phone, the same
  // way the project and pipeline forms do.
  const applyContact = (setter, value) => {
    setter(prev => {
      const person = findPerson(peopleAtFirm(contacts, prev.company, companies), value);
      return {
        ...prev,
        contact: value,
        email: person?.email || prev.email,
        phone: person?.phone || prev.phone
      };
    });
  };

  return (
    <>
      <div className="form-grid-2">
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-item`}>Part</label>
          <input
            id={`${idPrefix}-item`}
            className="field"
            autoComplete="off"
            placeholder="e.g. Replacement fan motor"
            value={values.item}
            onChange={e => setValues(prev => ({ ...prev, item: e.target.value }))}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-stage`}>Stage</label>
          <select
            id={`${idPrefix}-stage`}
            className="field"
            value={values.stage}
            onChange={e => setValues(prev => ({ ...prev, stage: e.target.value }))}
          >
            {PART_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor={`${idPrefix}-type`}>Firm type</label>
          <select
            id={`${idPrefix}-type`}
            className="field"
            value={values.companyCategory}
            onChange={e => setValues(prev => ({ ...prev, companyCategory: e.target.value }))}
          >
            {COMPANY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-firm`}>{values.companyCategory}</label>
          <FirmSelect
            id={`${idPrefix}-firm`}
            companies={companies}
            category={values.companyCategory}
            value={values.company}
            onChange={v => setValues(prev => ({ ...prev, company: v }))}
          />
        </div>

        <div>
          <label className="field-label" htmlFor={`${idPrefix}-contact`}>Contact</label>
          <PersonSelect
            id={`${idPrefix}-contact`}
            people={peopleAtFirm(contacts, values.company, companies)}
            value={values.contact}
            onChange={v => applyContact(setValues, v)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-value`}>Value</label>
          <MoneyInput
            id={`${idPrefix}-value`}
            placeholder="e.g. 4,200"
            value={values.value}
            onChange={v => setValues(prev => ({ ...prev, value: v }))}
          />
        </div>

        <div>
          <label className="field-label" htmlFor={`${idPrefix}-email`}>Email</label>
          <input id={`${idPrefix}-email`} className="field" autoComplete="off" value={values.email} onChange={e => setValues(prev => ({ ...prev, email: e.target.value }))} />
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-phone`}>Phone</label>
          <input id={`${idPrefix}-phone`} className="field" autoComplete="off" value={values.phone} onChange={e => setValues(prev => ({ ...prev, phone: e.target.value }))} />
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <label className="field-label" htmlFor={`${idPrefix}-address`}>Project address</label>
          <AddressAutocomplete
            id={`${idPrefix}-address`}
            name={`${idPrefix}-address`}
            placeholder="Where is this going?"
            value={values.projectAddress}
            onChange={v => setValues(prev => ({ ...prev, projectAddress: v }))}
          />
        </div>

        <div>
          <label className="field-label" htmlFor={`${idPrefix}-needed`}>Needed by</label>
          <input id={`${idPrefix}-needed`} className="field" type="date" value={values.neededBy} onChange={e => setValues(prev => ({ ...prev, neededBy: e.target.value }))} />
        </div>
      </div>

      <div style={{ marginTop: 6 }}>
        <label className="field-label">Contractors on this job (optional)</label>
        <p className="private-note-hint" style={{ marginTop: -4 }}>
          Whoever is doing the work, if that&apos;s not who the request came from. They&apos;re added to the Directory like any other firm.
        </p>
        {(values.contractors || []).map((row, i) => (
          <div key={i} className="form-grid-2" style={{ alignItems: "end", marginBottom: 6 }}>
            <div>
              <label className="field-label" htmlFor={`${idPrefix}-contractor-${i}`}>Contractor</label>
              <FirmSelect
                id={`${idPrefix}-contractor-${i}`}
                companies={companies}
                category="Contractor"
                value={row.company}
                onChange={v => setValues(prev => ({
                  ...prev,
                  contractors: (prev.contractors || []).map((r, x) => (x === i ? { ...r, company: v } : r))
                }))}
              />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
              <div style={{ flex: 1 }}>
                <label className="field-label" htmlFor={`${idPrefix}-contractor-contact-${i}`}>Their contact</label>
                <PersonSelect
                  id={`${idPrefix}-contractor-contact-${i}`}
                  people={peopleAtFirm(contacts, row.company, companies)}
                  value={row.contact}
                  onChange={v => setValues(prev => ({
                    ...prev,
                    contractors: (prev.contractors || []).map((r, x) => (x === i ? { ...r, contact: v } : r))
                  }))}
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setValues(prev => ({ ...prev, contractors: (prev.contractors || []).filter((_, x) => x !== i) }))}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setValues(prev => ({ ...prev, contractors: [...(prev.contractors || []), blankContractor()] }))}
        >
          + Add contractor
        </button>
      </div>

      <label className="field-label" htmlFor={`${idPrefix}-notes`}>Notes</label>
      <textarea
        id={`${idPrefix}-notes`}
        className="field"
        style={{ width: "100%", height: 70 }}
        value={values.notes}
        onChange={e => setValues(prev => ({ ...prev, notes: e.target.value }))}
      />
    </>
  );
}
