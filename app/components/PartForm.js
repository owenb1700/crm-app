"use client";

import { COMPANY_CATEGORIES } from "../../lib/directory";
import { PART_STAGES, blankContractor } from "../../lib/parts";
import { FirmSelect, PersonSelect, peopleAtFirm, findPerson } from "./DirectoryPickers";
import MoneyInput from "./MoneyInput";
import AddressAutocomplete from "./AddressAutocomplete";
import { LeadTimeFields } from "./LeadTimeFields";
import { normalizePhone } from "../../lib/tidyEntry";

// The fields of a parts request, shared by the Add box on the Parts list
// and the Edit form on a request's own page, so the two can't drift.
//
// Grouped the way the project and pipeline forms are: what the part is,
// then who it is for, then the dates and the extras. It used to be one
// flat two-column grid, which put Value between Contact and Email and a
// firm's phone number three rows below the firm -- fields next to each
// other that had nothing to do with each other.
//
// The blocks are dividers rather than cards, because this form sits
// inside a card already in both places it is used.
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

  const addressKnown = !!(values.projectAddress || "").trim();

  return (
    <>
      <div className="edit-block edit-block-lead">
        <h4 className="edit-block-title">The part</h4>
        <div className="form-grid-3">
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
            <label className="field-label" htmlFor={`${idPrefix}-value`}>Value</label>
            <MoneyInput
              id={`${idPrefix}-value`}
              placeholder="e.g. 4,200"
              value={values.value}
              onChange={v => setValues(prev => ({ ...prev, value: v }))}
            />
          </div>
        </div>

        {/* Required, because a part with no address can't be found later
            by the building it went to -- which is how most of them get
            looked up. When it genuinely isn't known yet, that is an
            answer too, and saying so is better than a blank field
            nobody can tell apart from a forgotten one. */}
        <label className="field-label" htmlFor={`${idPrefix}-address`}>Project address</label>
        <AddressAutocomplete
          id={`${idPrefix}-address`}
          name={`${idPrefix}-address`}
          placeholder="Where is this going?"
          value={values.projectAddress}
          onChange={v => setValues(prev => ({ ...prev, projectAddress: v, addressUnknown: v.trim() ? false : prev.addressUnknown }))}
        />
        <label className="export-notes-toggle" htmlFor={`${idPrefix}-address-unknown`} style={{ marginBottom: 0 }}>
          <input
            id={`${idPrefix}-address-unknown`}
            type="checkbox"
            checked={!addressKnown && values.addressUnknown === true}
            disabled={addressKnown}
            onChange={e => setValues(prev => ({ ...prev, addressUnknown: e.target.checked }))}
          />
          <span>
            <strong>Address not known yet</strong>
            <span className="export-row-desc">
              {addressKnown
                ? "An address is filled in, so this no longer applies."
                : "Tick this to save without one. Add it later from this part’s own page."}
            </span>
          </span>
        </label>

        {/* Below the address rather than up with Part/Stage/Value: it is
            a question about the job, same as the address is, not a quick
            fact like the part or its stage. */}
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-needed`}>Needed by</label>
          <input
            id={`${idPrefix}-needed`}
            className="field"
            type="date"
            value={values.neededBy}
            onChange={e => setValues(prev => ({ ...prev, neededBy: e.target.value }))}
          />
        </div>
      </div>

      <div className="edit-block">
        <h4 className="edit-block-title">Firm &amp; contact</h4>
        <div className="form-grid-3">
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
            <label className="field-label" htmlFor={`${idPrefix}-email`}>Email</label>
            <input
              id={`${idPrefix}-email`}
              className="field"
              autoComplete="off"
              value={values.email}
              onChange={e => setValues(prev => ({ ...prev, email: e.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor={`${idPrefix}-phone`}>Phone</label>
            <input
              id={`${idPrefix}-phone`}
              className="field"
              autoComplete="off"
              value={values.phone}
              onChange={e => setValues(prev => ({ ...prev, phone: e.target.value }))}
              onBlur={e => setValues(prev => ({ ...prev, phone: normalizePhone(e.target.value) }))}
            />
          </div>
        </div>
      </div>

      <div className="edit-block">
        <h4 className="edit-block-title">Lead time</h4>
        <LeadTimeFields idPrefix={idPrefix} values={values} setValues={setValues} defaultUnit="days" subject="This part" plural={false} inSection />
      </div>

      <div className="edit-block">
        <h4 className="edit-block-title">Contractors on this job</h4>
        <p className="edit-block-note">
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

      <div className="edit-block">
        <h4 className="edit-block-title">Notes</h4>
        <textarea
          id={`${idPrefix}-notes`}
          className="field"
          style={{ width: "100%", height: 70, marginBottom: 0 }}
          value={values.notes}
          onChange={e => setValues(prev => ({ ...prev, notes: e.target.value }))}
        />
      </div>
    </>
  );
}
