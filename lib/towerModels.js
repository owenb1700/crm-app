import { collection, addDoc } from "firebase/firestore";
import { db } from "./firebase";

export function towerModelKey(manufacturer, model) {
  return `${(manufacturer || "").trim().toLowerCase()}|${(model || "").trim().toLowerCase()}`;
}

// Silently creates a tower-model reference record (manufacturer + model,
// with its own shared PDF drawings) from data entered on a project or
// pipeline entry, the same way ensureCompanyAndContact builds up the
// company directory. Requires at least one of manufacturer/model -- a
// bare model number with no manufacturer (or vice versa) is still enough
// to identify a model worth tracking drawings against.
export async function ensureTowerModel({ towerModels, manufacturer, model, uid }) {
  const mfr = (manufacturer || "").trim();
  const mdl = (model || "").trim();
  if (!mfr && !mdl) return null;

  const key = towerModelKey(mfr, mdl);
  let towerModel = towerModels.find(t => towerModelKey(t.manufacturer, t.model) === key);
  if (towerModel) return towerModel;

  const ref = await addDoc(collection(db, "towerModels"), {
    manufacturer: mfr,
    model: mdl,
    drawings: [],
    createdAt: new Date().toISOString(),
    createdBy: uid
  });

  return { id: ref.id, manufacturer: mfr, model: mdl, drawings: [] };
}
