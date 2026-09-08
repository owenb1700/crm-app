"use client";

import { useEffect, useRef } from "react";

// Silent, app-wide safety net: if keyboard focus ever ends up stranded on
// <body> (which happens if a browser interaction detaches focus from
// whatever field the user was typing in), typing does nothing useful and
// space visibly scrolls/highlights the whole page. This watches for that
// exact stranded state and snaps focus back to the last real text field
// the user was in, with no dialog, hotkey, or DevTools needed from them.
export default function FocusGuard() {
  const lastFocused = useRef(null);

  useEffect(() => {
    const isTextField = (el) =>
      !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

    const handleFocusIn = (e) => {
      if (isTextField(e.target)) {
        lastFocused.current = e.target;
      }
    };

    const handleKeyDown = (e) => {
      const active = document.activeElement;
      const stranded = !active || active === document.body || active === document.documentElement;
      if (!stranded) return;

      const target = lastFocused.current;
      if (target && target.isConnected) {
        if (e.code === "Space") e.preventDefault();
        target.focus();
      }
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  return null;
}
