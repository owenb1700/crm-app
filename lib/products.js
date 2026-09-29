import { makersUsedForType } from "./learned";

export const PRODUCT_TYPES = [
  "Cooling Tower",
  "Fluid Cooler",
  "Water Cooled Chiller",
  "Air Cooled Chiller",
  "Modular Chiller",
  "Centrifugal Separator",
  "Strainer",
  "Heat Exchanger",
  "Coil",
  "Pre-Insulated Pipe"
];

// Suggested via datalist, but the field accepts any typed-in value --
// these are the manufacturers we work with most, not a hard whitelist.
export const PRODUCT_MANUFACTURERS = [
  "Evapco",
  "Smardt",
  "USA Coil & Air",
  "Thermacor",
  "SBS",
  "High-K",
  "Polaris",
  "ClimateWorx",
  "Miller Leaman"
];

// The manufacturers to offer for a kind of product, best guess first.
//
// What this company has actually used for this type leads, because that
// is the answer most of the time and it moves with the business. The
// standing list follows, so a type nobody has entered yet still offers
// somewhere to start. Neither is a whitelist -- every field using this
// takes a typed-in name.
export function manufacturerOptionsFor(type, history = {}, extra = []) {
  const used = makersUsedForType(type, history);
  const seen = new Set(used.map(m => m.toLowerCase()));
  const rest = [...extra, ...PRODUCT_MANUFACTURERS].filter(m => {
    const key = String(m || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...used, ...rest];
}
