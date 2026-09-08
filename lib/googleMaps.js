let loadPromise = null;

// Loads the Google Maps JS API (Places library) once and caches the
// promise, so every AddressAutocomplete instance on a page shares a
// single <script> tag. Resolves to null (silently) if no API key is
// configured, so address fields just fall back to plain text input
// instead of breaking the page.
export function loadGoogleMapsScript() {
  if (typeof window === "undefined") return Promise.resolve(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return Promise.resolve(null);

  if (window.google?.maps?.places) return Promise.resolve(window.google);

  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });

  return loadPromise;
}
