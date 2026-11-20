"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { previousLocation, popToPrevious, labelFor } from "../../lib/navHistory";

// "← Back to My Projects" -- where the name is the page you were actually
// on, not a destination hard-coded into this screen.
//
// Every caller still passes a fallback: open a project straight from an
// emailed link and there is no previous page, so Back has to mean
// something sensible rather than disappear.
export default function BackButton({
  fallback = "/dashboard#personal",
  fallbackLabel = "My Projects",
  arrow = false,
  className = "btn btn-secondary",
  ...rest
}) {
  const router = useRouter();
  // Resolved after mount: the trail lives in sessionStorage, which the
  // server can't see, and rendering a different label on the server than
  // the client is a hydration mismatch.
  const [target, setTarget] = useState({ loc: fallback, label: fallbackLabel });

  useEffect(() => {
    const prev = previousLocation();
    const label = labelFor(prev);
    // An unrecognised page (a route with no label) falls back rather than
    // showing "Back to null".
    if (prev && label) setTarget({ loc: prev, label });
  }, []);

  const goBack = () => {
    if (target.loc !== fallback) popToPrevious();
    router.push(target.loc);
  };

  return (
    <button type="button" className={className} onClick={goBack} {...rest}>
      {arrow ? "← " : ""}Back to {target.label}
    </button>
  );
}
