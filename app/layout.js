import { Inter } from "next/font/google";
import "./globals.css";
import FocusGuard from "./components/FocusGuard";
import TouchMenus from "./components/TouchMenus";
import NavHistory from "./components/NavHistory";

// One real typeface instead of whatever the operating system picks, so the
// app looks the same on a Mac, a Windows laptop and an iPad. Served from
// our own origin by next/font -- no Google Fonts request at page load.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter"
});

export const metadata = {
  // "%s" is whatever a page sets via usePageTitle; pages that set nothing
  // fall back to the company name on its own.
  title: {
    default: "Bullock Logan CRM",
    template: "%s · Bullock Logan CRM"
  },
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
    <html lang="en" className={inter.variable}>
      <body>
        <FocusGuard />
        <TouchMenus />
        <NavHistory />
        {children}
        <footer className="site-footer">
          © {new Date().getFullYear()} Bullock Logan. All rights reserved.
        </footer>
      </body>
    </html>
  );
}
