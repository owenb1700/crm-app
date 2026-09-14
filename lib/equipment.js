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
