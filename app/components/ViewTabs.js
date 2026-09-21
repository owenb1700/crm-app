"use client";

import { useRouter } from "next/navigation";
import { effectivePermissions } from "../../lib/permissions";
import { OWNER_CATEGORY } from "../../lib/directory";
import { canViewAnalytics } from "../../lib/analytics";
import RemindersMenu from "./RemindersMenu";
import GlobalSearch from "./GlobalSearch";

// The row of tabs under the header -- Home, My Projects, Pipeline,
// Directory, Analytics, Team, Past Projects, plus reminders and search.
// The dashboard passes onSelectView and switches tabs in place; every other
// page (Analytics, for one) leaves it out, and the tabs navigate back to
// the dashboard with the view in the hash instead. Each tab still respects
// what the person is allowed to see.
export default function ViewTabs({ profile, role, view, onSelectView, onAddReminder, searchData, extraTabs = null }) {
  const router = useRouter();

  const permissions = effectivePermissions(role || profile?.role, profile?.permissions);

  // On the dashboard this swaps the tab; anywhere else it goes there.
  const open = (name) => (onSelectView ? onSelectView(name) : router.push(`/dashboard#${name}`));
  const tabClass = (name) => `tab-btn ${view === name ? "tab-btn-active" : ""}`;

  return (
    <div className="view-tabs">
      {permissions.dashboard && (
        <>
          <button className={tabClass("home")} onClick={() => open("home")}>Home</button>
          <button className={tabClass("personal")} onClick={() => open("personal")}>My Projects</button>
        </>
      )}
      {permissions.pipeline && (
        <button className={tabClass("pipeline")} onClick={() => open("pipeline")}>Pipeline</button>
      )}

      {permissions.team && (
        <button className={tabClass("team")} onClick={() => open("team")}>Team</button>
      )}

      <button className={tabClass("pastProjects")} onClick={() => open("pastProjects")}>Past Projects</button>

      {canViewAnalytics(profile) && (
        <button className={tabClass("analytics")} onClick={() => router.push("/dashboard/analytics")}>
          Analytics
        </button>
      )}

      {/* Parts is everyone's -- no permission gate. */}
      <button className={tabClass("parts")} onClick={() => router.push("/dashboard/parts")}>Parts</button>

      {/* Directory sits last: it's a reference list people dip into, not a
          view of their own work like the tabs to its left. */}
      {(permissions.directory || permissions.towers || permissions.products) && (
        <div className="tab-dropdown">
          <button className="tab-btn">Directory ▾</button>
          <div className="tab-dropdown-menu">
            <div className="tab-dropdown-menu-card">
              {permissions.directory && (
                <>
                  <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory")}>All Companies</a>
                  <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory?category=Contractor")}>Contractors</a>
                  <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory?category=Engineering%20Firm")}>Engineering Firms</a>
                  <a className="tab-dropdown-item" onClick={() => router.push(`/dashboard/directory?category=${encodeURIComponent(OWNER_CATEGORY)}`)}>Owners &amp; Building Engineers</a>
                </>
              )}
              {permissions.towers && (
                <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory/towers")}>Installed Towers</a>
              )}
              {permissions.products && (
                <a className="tab-dropdown-item" onClick={() => router.push("/dashboard/directory/products")}>Product Options</a>
              )}
            </div>
          </div>
        </div>
      )}

      {extraTabs}

      <div className="header-tools">
        <RemindersMenu
          className="hide-with-mobile-nav"
          onAdd={onAddReminder || (() => router.push("/dashboard/reminders"))}
          onSeeAll={() => router.push("/dashboard/reminders")}
        />
        <GlobalSearch
          customers={searchData?.customers || []}
          pipelineEntries={searchData?.pipelineEntries || []}
          companies={searchData?.companies || []}
          contacts={searchData?.contacts || []}
          error={searchData?.error || ""}
        />
      </div>
    </div>
  );
}
