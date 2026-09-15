// Lets people add the CRM to their phone or iPad Home Screen, where it opens
// full-screen with its own icon instead of inside a browser tab.
export default function manifest() {
  return {
    name: "Bullock Logan CRM",
    short_name: "BL CRM",
    description: "Bullock, Logan & Associates customer relationship management",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0d1424",
    theme_color: "#0d1424",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
