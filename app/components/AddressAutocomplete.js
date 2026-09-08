"use client";

import { useEffect, useRef } from "react";
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

  return (
    <input
      ref={inputRef}
      id={id}
      name={name}
      className={className || "field"}
      autoComplete="off"
      placeholder={placeholder || "Project Address"}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  );
}
