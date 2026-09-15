"use client";

import { firmTypeOf, primaryEmail, primaryPhone } from "../../lib/directory";
import { blankBidder, blankContact } from "../../lib/bidders";
import FirmTypeSelect from "./FirmTypeSelect";
import { FirmSelect, PersonSelect, peopleAtFirm, findPerson } from "./DirectoryPickers";
import { sameCompany } from "../../lib/companyMatch";
import SalespersonSelect from "./SalespersonSelect";

// The Contractors & Owners Bidding editor used by Add Pipeline Entry and
// Pipeline Detail. One block per bidding firm (type, firm, salesperson),
// holding as many people from that firm as needed.
export default function BidderEditor({ idPrefix, bidders, onChange, companies, contacts, users }) {
  const peopleAt = (firm) => peopleAtFirm(contacts, firm);

  const updateBidder = (bi, patch) => onChange(bidders.map((b, i) => (i === bi ? { ...b, ...patch } : b)));
  const updateContact = (bi, ci, patch) => updateBidder(bi, {
    contacts: bidders[bi].contacts.map((c, i) => (i === ci ? { ...c, ...patch } : c))
  });

  // Picking a known person fills in their email and phone.
  const chooseContact = (bi, ci, name) => {
    const match = findPerson(peopleAt(bidders[bi].company), name);
    updateContact(bi, ci, match ? { name, email: primaryEmail(match), phone: primaryPhone(match) } : { name });
  };

  const removeContact = (bi, ci) => {
    const remaining = bidders[bi].contacts.filter((_, i) => i !== ci);
    updateBidder(bi, { contacts: remaining.length ? remaining : [blankContact()] });
  };

  return (
    <div className="bidder-editor">
      {bidders.map((b, bi) => {
        const type = firmTypeOf(b.category);
        const duplicate = !!(b.company || "").trim() && bidders.some((x, i) => i !== bi && sameCompany(x.company, b.company));
        return (
          <div key={bi} className="bidder-block">
            <div className="bidder-firm-row">
              <FirmTypeSelect id={`${idPrefix}-type-${bi}`} value={type} onChange={v => updateBidder(bi, { category: v })} />
              <div>
                <label className="field-label">{type}</label>
                <FirmSelect
                  id={`${idPrefix}-firm-${bi}`}
                  companies={companies}
                  category={type}
                  value={b.company}
                  onChange={v => updateBidder(bi, { company: v })}
                />
              </div>
              <SalespersonSelect
                id={`${idPrefix}-salesperson-${bi}`}
                users={users}
                value={b.salespersonId}
                onChange={v => updateBidder(bi, { salespersonId: v })}
              />
              <button type="button" className="btn btn-danger bidder-remove" onClick={() => onChange(bidders.filter((_, i) => i !== bi))}>
                Remove bidder
              </button>
            </div>

            {duplicate && (
              <p className="private-note-hint bidder-duplicate-note">
                {b.company} is already listed as a bidder. Its people will be combined into one bidder when you save.
              </p>
            )}

            <div className="bidder-people">
              <div className="bidder-people-title">People at {b.company || `this ${type.toLowerCase()}`}</div>
              {b.contacts.map((c, ci) => (
                <div key={ci} className="bidder-person-row">
                  <div>
                    <label className="field-label">Contact</label>
                    <PersonSelect id={`${idPrefix}-person-${bi}-${ci}`} people={peopleAt(b.company)} value={c.name} onChange={v => chooseContact(bi, ci, v)} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`${idPrefix}-email-${bi}-${ci}`}>Email</label>
                    <input id={`${idPrefix}-email-${bi}-${ci}`} className="field" autoComplete="off" value={c.email} onChange={e => updateContact(bi, ci, { email: e.target.value })} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`${idPrefix}-phone-${bi}-${ci}`}>Phone</label>
                    <input id={`${idPrefix}-phone-${bi}-${ci}`} className="field" autoComplete="off" value={c.phone} onChange={e => updateContact(bi, ci, { phone: e.target.value })} />
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary bidder-person-remove"
                    aria-label={`Remove ${c.name || "this person"}`}
                    onClick={() => removeContact(bi, ci)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="settings-link"
                onClick={() => updateBidder(bi, { contacts: [...b.contacts, blankContact()] })}
              >
                + Add person
              </button>
            </div>
          </div>
        );
      })}
      <button type="button" className="btn btn-secondary" onClick={() => onChange([...bidders, blankBidder()])}>+ Add Bidder</button>
    </div>
  );
}
