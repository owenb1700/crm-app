// A project's/pipeline entry's equipment used to be one fixed set of
// fields; it's now an array, but old records (and the legacy
// equipmentType/towerManufacturer/modelNumber/serialNumber/dateInstalled
// fields still written for backward compatibility) only ever have one.
// This turns whichever shape a given record is in into a uniform row
// list, so every page that reads equipment (project detail, Towers,
// Search) sees the same thing regardless of which shape it's reading.
export function equipmentRowsFrom(record) {
  if (Array.isArray(record.equipment) && record.equipment.length > 0) {
    return record.equipment.map(e => ({
      type: e.type || "",
      manufacturer: e.manufacturer || "",
      model: e.model || "",
      serial: e.serial || "",
      yearInstalled: e.yearInstalled || ""
    }));
  }
  const legacy = {
    type: record.equipmentType || "",
    manufacturer: record.towerManufacturer || "",
    model: record.modelNumber || "",
    serial: record.serialNumber || "",
    yearInstalled: record.dateInstalled || ""
  };
  const hasLegacy = Object.values(legacy).some(Boolean);
  return hasLegacy ? [legacy] : [];
}

// Pipeline entries quote products that aren't installed yet, so their rows
// are just type / manufacturer / model -- no serial number or install year.
export const blankProductRow = () => ({ type: "", manufacturer: "", model: "" });

export const productRowsFrom = (record) =>
  equipmentRowsFrom(record).map(({ type, manufacturer, model }) => ({ type, manufacturer, model }));

// For saving: trimmed, with rows that name nothing dropped.
export const productRowsForStorage = (rows) =>
  (rows || [])
    .map(r => ({
      type: String(r.type || "").trim(),
      manufacturer: String(r.manufacturer || "").trim(),
      model: String(r.model || "").trim()
    }))
    .filter(r => r.type || r.manufacturer || r.model);

// Tower models (with their shared drawings) are only tracked for cooling
// towers; rows saved before products had a type are assumed to be towers.
export const isTowerRow = (row) => !row.type || row.type === "Cooling Tower";
