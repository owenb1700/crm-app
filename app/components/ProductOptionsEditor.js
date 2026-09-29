"use client";

import { PRODUCT_TYPES, manufacturerOptionsFor } from "../../lib/products";
import { manufacturerForType } from "../../lib/learned";
import Suggested from "./Suggested";
import { blankProductRow } from "../../lib/equipment";
import SearchableSelect from "./SearchableSelect";

// The Product Options list on Add Pipeline Entry and Pipeline Detail: one
// row per product quoted (type, manufacturer, model). Manufacturer and
// model suggestions come from the Product Options directory, narrowed by
// what's already picked, but anything can be typed in.
//
// `history` is the jobs already on file. Pick a type and the makers this
// company actually uses for it come first, with the usual one offered
// underneath in a sentence saying how it was worked out. Nothing is
// filled in by itself -- the offer sits there until it's taken.
export default function ProductOptionsEditor({ idPrefix, rows, onChange, products, history = {} }) {
  const same = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
  const distinct = (list) => Array.from(new Set(list.filter(Boolean))).sort((a, b) => a.localeCompare(b));

  const ofType = (type) => products.filter(p => !type || same(p.type, type));
  // Used-here-before first, then this type's entries in the Product
  // Options directory, then the standing list.
  const manufacturerOptions = (row) =>
    manufacturerOptionsFor(row.type, history, distinct(ofType(row.type).map(p => p.manufacturer)));
  const modelOptions = (row) => distinct(
    ofType(row.type).filter(p => !row.manufacturer || same(p.manufacturer, row.manufacturer)).map(p => p.model)
  );

  const update = (index, patch) => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <div>
      {rows.map((row, i) => (
        <div key={i} className="equipment-row equipment-row-3">
          <select
            id={`${idPrefix}-type-${i}`}
            className="field"
            aria-label="Product type"
            value={row.type}
            onChange={e => update(i, { type: e.target.value })}
          >
            <option value="">Type of product...</option>
            {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            {row.type && !PRODUCT_TYPES.includes(row.type) && <option value={row.type}>{row.type}</option>}
          </select>
          <div>
            <SearchableSelect
              options={manufacturerOptions(row)}
              value={row.manufacturer}
              onChange={v => update(i, { manufacturer: v })}
              placeholder="Select or search manufacturer..."
              newLabel="manufacturer"
            />
            {!row.manufacturer && (
              <Suggested
                suggestion={manufacturerForType(row.type, history)}
                onUse={() => update(i, { manufacturer: manufacturerForType(row.type, history).value })}
              />
            )}
          </div>
          <SearchableSelect
            options={modelOptions(row)}
            value={row.model}
            onChange={v => update(i, { model: v })}
            placeholder="Select or search model..."
            newLabel="model"
          />
          <button type="button" className="btn btn-danger" onClick={() => onChange(rows.filter((_, x) => x !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary" onClick={() => onChange([...rows, blankProductRow()])}>+ Add Product</button>
    </div>
  );
}
