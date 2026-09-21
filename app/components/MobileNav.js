"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { OWNER_CATEGORY } from "../../lib/directory";
import { canViewAnalytics } from "../../lib/analytics";

// Same access rules as the desktop tab row: admins see everything; everyone
// else sees each area unless an admin switched it off for them (Analytics
// is the exception, off unless granted -- see canViewAnalytics).
const can = (profile, key) =>
  !!profile && (profile.role === "admin" || profile.permissions?.[key] !== false);

// The three-line menu in the top-left of every page's header. Only shown on
// phones and iPads (the CSS hides it where the desktop tab row is used).
// On the main dashboard, `onSelectView` switches tabs in place; on every
// other page, choosing a dashboard tab goes to /dashboard#<tab>.
export default function MobileNav({ uid, profile: profileProp, currentView, onSelectView }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(profileProp || null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (profileProp) {
      setProfile(profileProp);
      return;
    }
    if (!uid) return;
    getDoc(doc(db, "users", uid))
      .then(snap => { if (snap.exists()) setProfile(snap.data()); })
      .catch(() => {});
  }, [uid, profileProp]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const goView = (view) => {
    setOpen(false);
    if (onSelectView) onSelectView(view);
    else router.push(`/dashboard#${view}`);
  };

  const goPath = (path) => {
    setOpen(false);
    router.push(path);
  };

  const onDashboard = pathname === "/dashboard" && !!onSelectView;
  const category = searchParams?.get("category") || "";
  const isView = (v) => onDashboard && currentView === v;
  const isPath = (p, cat) => pathname === p && (cat === undefined || category === cat);

  const sections = [
    {
      items: [
        can(profile, "dashboard") && { label: "Home", active: isView("home"), onClick: () => goView("home") },
        can(profile, "dashboard") && { label: "My Projects", active: isView("personal"), onClick: () => goView("personal") },
        can(profile, "pipeline") && { label: "Pipeline", active: isView("pipeline"), onClick: () => goView("pipeline") },
        canViewAnalytics(profile) && { label: "Analytics", active: isPath("/dashboard/analytics"), onClick: () => goPath("/dashboard/analytics") },
        { label: "Parts", active: isPath("/dashboard/parts"), onClick: () => goPath("/dashboard/parts") },
        { label: "Project Addresses", active: isPath("/dashboard/directory/addresses"), onClick: () => goPath("/dashboard/directory/addresses") },
        can(profile, "team") && { label: "Team", active: isView("team"), onClick: () => goView("team") },
        { label: "Past Projects", active: isView("pastProjects"), onClick: () => goView("pastProjects") },
        { label: "All Alerts", active: isPath("/dashboard/alerts"), onClick: () => goPath("/dashboard/alerts") },
        { label: "Reminders", active: isPath("/dashboard/reminders"), onClick: () => goPath("/dashboard/reminders") }
      ]
    },
    {
      title: "Directory",
      items: [
        can(profile, "directory") && { label: "All Companies", active: isPath("/dashboard/directory", ""), onClick: () => goPath("/dashboard/directory") },
        can(profile, "directory") && { label: "Contractors", active: isPath("/dashboard/directory", "Contractor"), onClick: () => goPath("/dashboard/directory?category=Contractor") },
        can(profile, "directory") && { label: "Engineering Firms", active: isPath("/dashboard/directory", "Engineering Firm"), onClick: () => goPath("/dashboard/directory?category=Engineering%20Firm") },
        can(profile, "directory") && { label: "Owners & Building Engineers", active: isPath("/dashboard/directory", OWNER_CATEGORY), onClick: () => goPath(`/dashboard/directory?category=${encodeURIComponent(OWNER_CATEGORY)}`) },
        can(profile, "towers") && { label: "Installed Towers", active: isPath("/dashboard/directory/towers"), onClick: () => goPath("/dashboard/directory/towers") },
        can(profile, "products") && { label: "Product Options", active: isPath("/dashboard/directory/products"), onClick: () => goPath("/dashboard/directory/products") }
      ]
    },
    profile?.role === "admin" && {
      items: [{ label: "Admin Settings", active: isView("admin"), onClick: () => goView("admin") }]
    }
  ]
    .filter(Boolean)
    .map(s => ({ ...s, items: s.items.filter(Boolean) }))
    .filter(s => s.items.length);

  return (
    <div className="mobile-nav" ref={wrapRef}>
      <button
        type="button"
        className="mobile-nav-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-nav-menu"
        onClick={() => setOpen(o => !o)}
      >
        <span className="mobile-nav-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      {open && (
        <nav id="mobile-nav-menu" className="mobile-nav-menu" aria-label="Main menu">
          {sections.map((section, i) => (
            <div key={i} className="mobile-nav-section">
              {section.title && <div className="mobile-nav-section-title">{section.title}</div>}
              {section.items.map(item => (
                <button
                  key={item.label}
                  type="button"
                  className={`mobile-nav-item ${item.active ? "is-active" : ""}`}
                  aria-current={item.active ? "page" : undefined}
                  onClick={item.onClick}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}
