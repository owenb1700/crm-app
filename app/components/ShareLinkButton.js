"use client";

import { useEffect, useRef, useState } from "react";

// Copies this page's own URL -- nothing more. The link doesn't carry any
// special access: whoever opens it still has to sign in, and still only
// sees what their normal permissions already allow (owner, collaborator,
// or admin). This is purely "here's how to find this record" instead of
// someone hunting for it by name.
export default function ShareLinkButton({ className = "btn btn-secondary" }) {
  const [state, setState] = useState("idle"); // idle | copied | failed
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const url = `${window.location.origin}${window.location.pathname}`;
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      // No clipboard permission, or not on https/localhost. The URL bar
      // already has the same link, so this isn't a dead end -- just say
      // so instead of silently doing nothing.
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  };

  const label = state === "copied" ? "Link Copied" : state === "failed" ? "Copy the Address Bar" : "Share Link";

  return (
    <button
      type="button"
      className={className}
      // Stops the click from also closing a dropdown menu this sits
      // inside -- the whole point of copying is to show the "Link
      // Copied" confirmation on the button itself, which nobody sees if
      // the menu disappears in the same click.
      onClick={(e) => { e.stopPropagation(); copy(); }}
    >
      {label}
    </button>
  );
}
