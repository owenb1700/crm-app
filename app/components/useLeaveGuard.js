"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Stops a part-filled form being abandoned by accident.
//
// Two ways out need catching, and only two: closing or refreshing the
// tab, which only the browser's own prompt can interrupt, and the back
// button, which the app can catch itself. Cancel and Save are plain
// router pushes the page already knows about, so they never come here.
//
// The back button is trapped by pushing a spare history entry on mount.
// Pressing back then lands on that entry -- firing popstate rather than
// leaving -- which buys the time to ask. Answering "stay" pushes the
// spare entry back so the trap is armed for next time.
//
// Returns `asking`, which the page renders its own dialog from. The
// asking is deliberately not `window.confirm`: that blocks the whole
// renderer until it's dismissed, so the page behind it stops responding.
export default function useLeaveGuard(active, onLeave) {
  const [asking, setAsking] = useState(false);
  // Held so leaving can take the tab prompt off again. A fresh function
  // passed to removeEventListener removes nothing -- it has to be the
  // same reference that was added.
  const unloadHandler = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    unloadHandler.current = onBeforeUnload;
    window.addEventListener("beforeunload", onBeforeUnload);
    window.history.pushState(null, "", window.location.href);

    const onPopState = () => setAsking(true);
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
      unloadHandler.current = null;
    };
  }, [active]);

  // Going: the tab prompt comes off first, or leaving raises the very
  // prompt the person has just answered.
  const leave = useCallback(() => {
    setAsking(false);
    if (unloadHandler.current) {
      window.removeEventListener("beforeunload", unloadHandler.current);
      unloadHandler.current = null;
    }
    onLeave?.();
  }, [onLeave]);

  // Staying: re-arm the trap, since the spare entry was just spent.
  const stay = useCallback(() => {
    setAsking(false);
    window.history.pushState(null, "", window.location.href);
  }, []);

  return { asking, leave, stay };
}
