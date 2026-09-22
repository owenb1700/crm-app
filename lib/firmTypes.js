import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { sameCompany } from "./companyMatch";

// Records what a firm is, on the firm itself, so it's answered once and
// then known everywhere it comes up: what a contractor does, or what sort
// of buildings an owner or engineering firm has.
//
// The firm may have just been created by the save that prompted this, so
// the companies list is re-read rather than trusted from the page.
export async function saveFirmTags(firmName, category, tags) {
  const name = (firmName || "").trim();
  const wanted = (Array.isArray(tags) ? tags : [tags]).filter(Boolean);
  if (!name || !wanted.length) return false;
  const snap = await getDocs(collection(db, "companies"));
  const firm = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .find(c => sameCompany(c.name, name));
  if (!firm) return false;

  // Contractors are described by what they do; everyone else by the
  // buildings they have.
  const field = (category || firm.category) === "Contractor" ? "workTypes" : "sectors";
  const existing = Array.isArray(firm[field]) ? firm[field].filter(Boolean) : [];
  const merged = [...new Set([...existing, ...wanted])];
  if (merged.length === existing.length) return true;
  await updateDoc(doc(db, "companies", firm.id), { [field]: merged });
  return true;
}

// Kept for the parts form's single-choice prompt.
export const saveContractorType = (firmName, type) => saveFirmTags(firmName, "Contractor", [type]);
