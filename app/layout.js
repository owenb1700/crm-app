import "./globals.css";
import FocusGuard from "./components/FocusGuard";
import TouchMenus from "./components/TouchMenus";

export const metadata = {
  title: "CRM App",
  applicationName: "Bullock Logan CRM",
  // When added to an iPhone/iPad Home Screen: open full-screen, with the
  // short name under the icon and a dark status bar over the navy header.
  appleWebApp: {
    capable: true,
    title: "BL CRM",
    statusBarStyle: "black-translucent"
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the header extend under the iPhone notch; the CSS pads it back
  // with the safe-area insets.
  viewportFit: "cover",
  themeColor: "#0d1424"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <FocusGuard />
        <TouchMenus />
        {children}
        <footer className="site-footer">
          © {new Date().getFullYear()} Bullock Logan. All rights reserved.
        </footer>
      </body>
    </html>
  );
}
