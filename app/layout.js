import "./globals.css";
import FocusGuard from "./components/FocusGuard";

export const metadata = {
  title: "CRM App",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <FocusGuard />
        {children}
        <footer className="site-footer">
          © {new Date().getFullYear()} Bullock Logan. All rights reserved.
        </footer>
      </body>
    </html>
  );
}
