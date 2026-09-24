"use client";

import { useEffect, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { withoutTrashed } from "../../lib/trash";
import { collectAddresses, findSimilarAddresses } from "../../lib/addresses";
import { loadGoogleMapsScript } from "../../lib/googleMaps";
import { NOT_APPLICABLE, isNotApplicable, worthCorrecting, addressState, addressWarning } from "../../lib/tidyEntry";

// Wraps a plain address input with Google's Places Autocomplete when an
// API key is configured (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY). Only real,
// geocoded addresses can be selected from the dropdown, so picking a
// suggestion guarantees a validated address (postal code included
// whenever Google has one on file). With no key set, this is just a
// normal text input -- nothing breaks, autocomplete is simply off.
//
// Typing an address by hand still works, because people are faster than an
// autocomplete. But a typed address gets looked up afterwards, and if
// Google knows a tidier version of it that version is offered -- so the
// same building doesn't end up on file three ways. Nothing is rewritten
// without being asked.
export default function AddressAutocomplete({ id, name, value, onChange, placeholder, className, onConfirmedChange }) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  // Buildings already worked at. Fetched once, the first time someone
  // uses the box, so no page pays for it just by existing.
  const [known, setKnown] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [tidier, setTidier] = useState(null);

  const setConfirmedState = (next) => {
    setConfirmed(next);
    if (onConfirmedChange) onConfirmedChange(next);
  };

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
          setConfirmedState(true);
          setTidier(null);
        }
      });

      autocompleteRef.current = autocomplete;
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When somebody types an address instead of picking one, ask Google what
  // it thinks that address is. If it comes back meaningfully different,
  // offer the tidy version rather than silently swapping it.
  const checkTyped = async () => {
    const typed = String(value || "").trim();
    if (!typed || isNotApplicable(typed) || confirmed) return;

    const google = await loadGoogleMapsScript().catch(() => null);
    if (!google?.maps?.places) return;

    try {
      const service = new google.maps.places.AutocompleteService();
      const results = await new Promise((resolve) => {
        service.getPlacePredictions({ input: typed, types: ["address"] }, (predictions, status) => {
          resolve(status === google.maps.places.PlacesServiceStatus.OK ? predictions || [] : []);
        });
      });
      const best = results[0]?.description;
      if (best && worthCorrecting(typed, best)) setTidier(best);
      else if (best) setConfirmedState(true);
    } catch {
      // A lookup that fails leaves the typed address exactly as it is.
    }
  };

  // Buildings already worked at that this looks like -- so the same site
  // doesn't quietly become two.
  const similar = findSimilarAddresses(known || [], value);
  const state = addressState({ value, confirmed });
  const warning = addressWarning(state);

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
        onChange={e => {
          onChange(e.target.value);
          setConfirmedState(false);
          setTidier(null);
        }}
        onFocus={loadKnown}
        onBlur={checkTyped}
        disabled={isNotApplicable(value)}
      />

      {isNotApplicable(value) ? (
        <p className="private-note-hint" style={{ marginTop: 4 }}>
          No address on this one.{" "}
          <button type="button" className="link-muted matching-select-link" onClick={() => { onChange(""); setConfirmedState(false); }}>
            Enter an address instead
          </button>
        </p>
      ) : (
        <p className="private-note-hint" style={{ marginTop: 4 }}>
          {state === "confirmed" && "✓ Found on Google Maps."}
          {state !== "confirmed" && (
            <>
              {warning}{" "}
              <button
                type="button"
                className="link-muted matching-select-link"
                onClick={() => { onChange(NOT_APPLICABLE); setConfirmedState(false); setTidier(null); }}
              >
                Not applicable
              </button>
            </>
          )}
        </p>
      )}

      {tidier && (
        <p className="matching-select-suggestion">
          Google Maps has this as{" "}
          <button
            type="button"
            className="link-muted matching-select-link"
            onClick={() => { onChange(tidier); setConfirmedState(true); setTidier(null); }}
          >
            {tidier}
          </button>
          . Using it keeps the spelling the same everywhere.
        </p>
      )}

      {similar.length > 0 && (
        <p className="matching-select-suggestion">
          Already worked at{" "}
          {similar.map((b, i) => (
            <span key={b.key}>
              {i > 0 && " or "}
              <button type="button" className="link-muted matching-select-link" onClick={() => { onChange(b.label); setConfirmedState(true); }}>{b.label}</button>
            </span>
          ))}
          ? Picking one keeps this job with the others there.
        </p>
      )}
    </>
  );
}
