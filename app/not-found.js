import Link from "next/link";

// The stock Next.js 404 is an unstyled black-on-white page with its own
// typeface -- it looks like a different website. This is the same page
// furniture as the rest of the app.
export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="dashboard-page not-found-page">
      <div className="admin-card not-found-card">
        <img src="/logo.svg" alt="Bullock Logan" className="not-found-logo" />
        <h1 className="not-found-title">Page not found</h1>
        <p className="not-found-text">
          That link doesn&apos;t go anywhere. It may have been deleted, or the
          address may have been mistyped.
        </p>
        <Link className="btn btn-primary" href="/dashboard">
          Back to My Projects
        </Link>
      </div>
    </div>
  );
}
