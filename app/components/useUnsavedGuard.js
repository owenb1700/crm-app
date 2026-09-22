"use client";

import { useEffect } from "react";

// Warns before the tab is closed, refreshed, or navigated away from while
// a form is part-filled. Only covers the ways out the app can't see --
// Cancel and Save are plain router pushes, so they never trigger it.
//
// Pass `active` as true only while there is something to lose.
export default function useUnsavedGuard(active) {
  useEffect(() => {
    if (!active) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}
