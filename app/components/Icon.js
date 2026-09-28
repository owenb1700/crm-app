// Line icons, drawn rather than borrowed from the emoji font.
//
// Emoji render in colour, differently on every platform, and at whatever
// size the font feels like -- which is what made the site look homemade.
// These inherit currentColor and the surrounding font size, so a bell in
// a muted hint is muted and a bell on a dark header is light.
//
// Add one by putting its paths in ICONS. Everything is drawn on a 16x16
// box with a 1.4 stroke so they sit together evenly.

const ICONS = {
  // A reminder, an alert, the notification bell.
  bell: (
    <>
      <path d="M8 2.2a3.8 3.8 0 0 0-3.8 3.8c0 3-1.1 3.9-1.5 4.3a.5.5 0 0 0 .35.86h9.9a.5.5 0 0 0 .35-.86c-.4-.4-1.5-1.3-1.5-4.3A3.8 3.8 0 0 0 8 2.2Z" />
      <path d="M6.6 13.4a1.6 1.6 0 0 0 2.8 0" strokeLinecap="round" />
    </>
  ),
  // Two people: collaborating, shared with someone.
  people: (
    <>
      <circle cx="6" cy="5.4" r="2.2" />
      <path d="M2.2 13.2c0-2.1 1.7-3.4 3.8-3.4s3.8 1.3 3.8 3.4" strokeLinecap="round" />
      <path d="M10.8 3.5a2.2 2.2 0 0 1 0 4.1M11.6 9.9c1.4.3 2.4 1.4 2.4 3.3" strokeLinecap="round" />
    </>
  ),
  // Won, done, confirmed.
  check: <path d="M3.2 8.4 6.4 11.6l6.4-7.2" strokeLinecap="round" strokeLinejoin="round" />,
  // Private, owned by someone else.
  lock: (
    <>
      <rect x="3.2" y="7" width="9.6" height="6.8" rx="1.4" />
      <path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" strokeLinecap="round" />
    </>
  ),
  search: (
    <>
      <circle cx="7.1" cy="7.1" r="4.3" />
      <path d="m10.3 10.3 3 3" strokeLinecap="round" />
    </>
  ),
  // Did not bid: a job deliberately passed on.
  ban: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="m4.2 4.2 7.6 7.6" strokeLinecap="round" />
    </>
  ),
  // Lost.
  cross: <path d="m4.4 4.4 7.2 7.2M11.6 4.4l-7.2 7.2" strokeLinecap="round" />,
  calendar: (
    <>
      <rect x="1.7" y="3" width="12.6" height="11.3" rx="1.6" />
      <path d="M1.7 6.6h12.6" />
      <path d="M5.3 1.7v2.4M10.7 1.7v2.4" strokeLinecap="round" />
    </>
  )
};

export default function Icon({ name, size = 14, className = "", title }) {
  const paths = ICONS[name];
  if (!paths) return null;
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      {paths}
    </svg>
  );
}
