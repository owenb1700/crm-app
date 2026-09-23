"use client";

import { useEffect, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { withoutTrashed } from "../../lib/trash";
import { collectAddresses, findSimilarAddresses } from "../../lib/addresses";
import { loadGoogleMapsScript } from "../../lib/googleMaps";

// Wraps a plain address input with Google's Places Autocomplete when an
// API key is configured (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY). Only real,
// geocoded addresses can be selected from the dropdown, so picking a
// suggestion guarantees a validated address (postal code included
// whenever Google has one on file). With no key set, this is just a
// normal text input -- nothing breaks, autocomplete is simply off.
export default function AddressAutocomplete({ id, name, value, onChange, placeholder, className }) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  // Buildings already worked at. Fetched once, the first time someone
  // uses the box, so no page pays for it just by existing.
  const [known, setKnown] = useState(null);

  const loadKnown = async () => {
    if (known) return;
    try {
      const [projectsSnap, pipelineSnap, partsSnap] = await Promise.all([
        getDocs(collection(db, "customers")),
        getDocs(collection(db, "pipeline")),
        getDocs(collection(db, "parts"))
      ]);
      const rows = (snap) => withoutTrashed(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setKnown(collectAddresses({ projects: rows(projectsSnap), pipeline: rows(pipelineSnap), parts: rows(partsSnap) }));
    } catch {
      // Without this the box still works; it just can't warn.
      setKnown([]);
    }
  };

  useEffect(() => {
    let cancelled = false;

    loadGoogleMapsScript().then((google) => {
      if (cancelled || !google || !inputRef.current || autocompleteRef.current) return;

      const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
        types: ["address"],
        fields: ["formatted_address"]
      });

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (place?.formatted_address) {
          onChange(place.formatted_address);
        }
      });

      autocompleteRef.current = autocomplete;
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Buildings already worked at that this looks like -- so the same site
  // doesn't quietly become two.
  const similar = findSimilarAddresses(known || [], value);

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        name={name}
        className={className || "field"}
        autoComplete="off"
        placeholder={placeholder || "Project Address"}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={loadKnown}
      />
      {similar.length > 0 && (
        <p className="matching-select-suggestion">
          Already worked at{" "}
          {similar.map((b, i) => (
            <span key={b.key}>
              {i > 0 && " or "}
              <button type="button" className="link-muted matching-select-link" onClick={() => onChange(b.label)}>{b.label}</button>
            </span>
          ))}
          ? Picking one keeps this job with the others there.
        </p>
      )}
    </>
  );
}
