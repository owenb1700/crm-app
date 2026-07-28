import "./globals.css";

export const metadata = {
  title: "CRM App",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
