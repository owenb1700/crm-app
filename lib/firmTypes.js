import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { sameCompany } from "./companyMatch";

// Records what kind of contractor a firm is, on the firm itself, so it's
// answered once and then known everywhere it comes up. Used after the
// parts form asks (see ContractorTypePrompt).
//
// The firm may have just been created by the save that prompted this, so
// the companies list is re-read rather than trusted from the page.
export async function saveContractorType(firmName, type) {
  const name = (firmName || "").trim();
  if (!name || !type) return false;
  const snap = await getDocs(collection(db, "companies"));
  const firm = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .find(c => sameCompany(c.name, name));
  if (!firm) return false;

  const existing = Array.isArray(firm.workTypes) ? firm.workTypes.filter(Boolean) : [];
  if (existing.includes(type)) return true;
  await updateDoc(doc(db, "companies", firm.id), { workTypes: [...existing, type] });
  return true;
}
