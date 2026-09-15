"use client";

import { useEffect } from "react";

const MENU_SELECTOR = ".avatar-menu, .alerts-menu, .tab-dropdown";
const TRIGGER_SELECTOR = ".avatar-circle, .tab-btn";

// The alerts bell, avatar menu, and Directory menu open on mouse hover. A
// touch screen has no hover, so this makes them open and close by tapping
// instead, app-wide: tapping a menu's trigger toggles it (adding .is-open,
// which the CSS shows), tapping anywhere outside or pressing Escape closes
// it, and choosing an item in the avatar or Directory menu closes it too.
// The alerts panel stays open while you work in it (Approve, Mark all
// read). Mouse users are unaffected -- hover still works for them.
export default function TouchMenus() {
  useEffect(() => {
    const closeAll = (except) => {
      document.querySelectorAll(`${MENU_SELECTOR}`).forEach(m => {
        if (m !== except) m.classList.remove("is-open");
      });
    };

    const onClick = (e) => {
      const menu = e.target.closest(MENU_SELECTOR);
      if (!menu) {
        closeAll();
        return;
      }

      const trigger = e.target.closest(TRIGGER_SELECTOR);
      if (trigger && menu.contains(trigger) && !trigger.closest(".avatar-dropdown, .alerts-dropdown, .tab-dropdown-menu")) {
        const willOpen = !menu.classList.contains("is-open");
        closeAll(menu);
        menu.classList.toggle("is-open", willOpen);
        return;
      }

      // Picking something from the avatar or Directory menu closes it.
      if (!menu.classList.contains("alerts-menu") && e.target.closest("button, a, .tab-dropdown-item")) {
        menu.classList.remove("is-open");
      }
    };

    const onKey = (e) => {
      if (e.key === "Escape") closeAll();
    };

    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return null;
}
