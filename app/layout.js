import "./globals.css";

export const metadata = {
  title: "CRM App",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="site-footer">
          © {new Date().getFullYear()} Bullock Logan. All rights reserved.
        </footer>
      </body>
    </html>
  );
}
