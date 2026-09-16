"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { equipmentRowsFrom } from "../../lib/equipment";
import { bidderContactNames } from "../../lib/bidders";
import { withoutTrashed } from "../../lib/trash";

// The header's "Search everything" box: typing lists the closest matches
// across projects, pipeline entries, the Directory, towers, and products --
// click one to go straight there. Search (or Enter) still opens the full
// results page. Products and tower models aren't loaded by the dashboard,
// so they're fetched once the first time someone searches here.
const LIMIT_PER_GROUP = 4;
const LIMIT_TOTAL = 10;

const has = (q, fields) => fields.some(f => String(f || "").toLowerCase().includes(q));

export default function GlobalSearch({ customers = [], pipelineEntries = [], companies = [], contacts = [] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState(null); // { products, towerModels }
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open || extra) return;
    let cancelled = false;
    (async () => {
      try {
        const [productsSnap, modelsSnap] = await Promise.all([
          getDocs(collection(db, "products")),
          getDocs(collection(db, "towerModels"))
        ]);
        if (cancelled) return;
        setExtra({
          products: productsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          towerModels: modelsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        });
      } catch {
        // Suggestions just stay limited to what the page already has.
        if (!cancelled) setExtra({ products: [], towerModels: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [open, extra]);

  useEffect(() => {
    if (!open) return undefined;
    const onPressOutside = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPressOutside);
    return () => document.removeEventListener("pointerdown", onPressOutside);
  });

  const q = query.trim().toLowerCase();

  const equipmentFields = (record) => equipmentRowsFrom(record).flatMap(r => [r.type, r.manufacturer, r.model, r.serial]);

  const suggestions = [];
  if (q) {
    const push = (items, make) => {
      items.slice(0, LIMIT_PER_GROUP).forEach(item => suggestions.push(make(item)));
    };

    push(
      withoutTrashed(customers).filter(c => has(q, [c.projectName, c.company, c.contact, c.projectAddress, ...equipmentFields(c)])),
      c => ({
        key: `project-${c.id}`, kind: "Project", name: c.projectName || c.company || "Untitled project",
        sub: [c.company !== c.projectName ? c.company : "", c.category].filter(Boolean).join(" · "),
        href: `/dashboard/project/${c.id}`
      })
    );
    push(
      withoutTrashed(pipelineEntries).filter(p => has(q, [
        p.title, p.company, p.contact, p.projectAddress, ...equipmentFields(p),
        ...(p.biddingCompanies || []).map(b => b.company), ...bidderContactNames(p.biddingCompanies)
      ])),
      p => ({
        key: `pipeline-${p.id}`, kind: "Pipeline", name: p.title || "Untitled pipeline entry",
        sub: [p.stage, p.company].filter(Boolean).join(" · "),
        href: `/dashboard/pipeline/${p.id}`
      })
    );
    push(
      companies.filter(c => has(q, [c.name, c.phone, c.address, c.website])),
      c => ({ key: `company-${c.id}`, kind: c.category || "Company", name: c.name, sub: c.address || "", href: `/dashboard/directory/company/${c.id}` })
    );
    push(
      contacts.filter(p => has(q, [p.name, p.title, p.companyName, ...(p.emails || [p.email]), ...(p.phones || [p.phone])])),
      p => ({
        key: `person-${p.id}`, kind: "Person", name: p.name,
        sub: [p.title, p.companyName].filter(Boolean).join(" · "),
        href: p.companyId ? `/dashboard/directory/company/${p.companyId}` : "/dashboard/directory"
      })
    );
    push(
      (extra?.towerModels || []).filter(m => has(q, [m.manufacturer, m.model])),
      m => ({
        key: `model-${m.id}`, kind: "Tower model", name: [m.manufacturer, m.model].filter(Boolean).join(" "),
        sub: `${(m.drawings || []).length} drawing${(m.drawings || []).length === 1 ? "" : "s"}`,
        href: `/dashboard/directory/tower-model/${m.id}`
      })
    );
    push(
      (extra?.products || []).filter(p => has(q, [p.name, p.type, p.manufacturer, p.model])),
      p => ({
        key: `product-${p.id}`, kind: "Product", name: p.name || [p.manufacturer, p.model].filter(Boolean).join(" "),
        sub: [p.type, p.manufacturer].filter(Boolean).join(" · "),
        href: `/dashboard/directory/product/${p.id}`
      })
    );

    // Installed towers are derived from equipment serial numbers.
    const serials = new Map();
    withoutTrashed(customers).forEach(c => equipmentRowsFrom(c).forEach(row => {
      const serial = (row.serial || "").trim();
      if (serial && has(q, [serial, row.manufacturer, row.model]) && !serials.has(serial.toLowerCase())) {
        serials.set(serial.toLowerCase(), {
          key: `tower-${serial}`, kind: "Installed tower", name: `Serial ${serial}`,
          sub: [row.manufacturer, row.model].filter(Boolean).join(" "),
          href: `/dashboard/directory/tower/${encodeURIComponent(serial)}`
        });
      }
    }));
    [...serials.values()].slice(0, LIMIT_PER_GROUP).forEach(t => suggestions.push(t));
  }

  const shown = suggestions.slice(0, LIMIT_TOTAL);
  const more = suggestions.length - shown.length;

  const goToResults = () => {
    if (!q) return;
    setOpen(false);
    router.push(`/dashboard/search?q=${encodeURIComponent(query.trim())}`);
  };

  const goTo = (href) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <form
      className="global-search"
      ref={boxRef}
      onSubmit={e => { e.preventDefault(); goToResults(); }}
    >
      <div className="global-search-box">
        <input
          className="field global-search-input"
          placeholder="Search everything..."
          value={query}
          autoComplete="off"
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
        />
        {open && q && (
          <div className="tab-dropdown-menu-card global-search-menu" role="listbox">
            {shown.length === 0 && <div className="global-search-empty">No matches yet — press Search to look everywhere.</div>}
            {shown.map(item => (
              <div
                key={item.key}
                role="option"
                aria-selected="false"
                className="tab-dropdown-item global-search-item"
                onPointerDown={e => { e.preventDefault(); goTo(item.href); }}
              >
                <span className="global-search-kind">{item.kind}</span>
                <span className="global-search-text">
                  <span className="global-search-name">{item.name}</span>
                  {item.sub && <span className="global-search-sub">{item.sub}</span>}
                </span>
              </div>
            ))}
            <div
              role="option"
              aria-selected="false"
              className="tab-dropdown-item global-search-all"
              onPointerDown={e => { e.preventDefault(); goToResults(); }}
            >
              See all results for &quot;{query.trim()}&quot;{more > 0 ? ` (${more} more here)` : ""}
            </div>
          </div>
        )}
      </div>
      <button className="btn btn-secondary search-submit" type="submit" aria-label="Search">
        <span className="search-submit-text">Search</span>
        <span className="search-submit-icon" aria-hidden="true">🔍</span>
      </button>
    </form>
  );
}
