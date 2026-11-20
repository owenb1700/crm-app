"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordLocation, locationOf } from "../../lib/navHistory";

// Records every page visited, so Back knows where it came from. Mounted
// once in the root layout; renders nothing.
//
// Three things move the location in this app and only one of them fires a
// normal event:
//   - following a link        -> usePathname changes
//   - browser back / forward  -> popstate
//   - switching dashboard tabs-> history.pushState, which fires nothing
// so pushState is wrapped once to announce itself.
export default function NavHistory() {
  const pathname = usePathname();

  useEffect(() => {
    recordLocation(locationOf(window));
  }, [pathname]);

  useEffect(() => {
    const record = () => recordLocation(locationOf(window));

    const original = window.history.pushState;
    window.history.pushState = function patched(...args) {
      const result = original.apply(this, args);
      // After the URL has actually changed, not before.
      window.dispatchEvent(new Event("navhistory:pushstate"));
      return result;
    };

    window.addEventListener("navhistory:pushstate", record);
    window.addEventListener("popstate", record);
    window.addEventListener("hashchange", record);

    return () => {
      window.history.pushState = original;
      window.removeEventListener("navhistory:pushstate", record);
      window.removeEventListener("popstate", record);
      window.removeEventListener("hashchange", record);
    };
  }, []);

  return null;
}
