/**
 * The app's own launch screen, drawn to match the PWA splash the OS shows
 * first: same background, same mark, same wordmark, in the same place.
 *
 * The point is continuity. An installed app gets a system splash it cannot
 * control, and if the first thing the app paints looks different — a spinner in
 * a corner, a shifted logo, a blank frame — it reads as a *second* splash. By
 * rendering the identical lockup, and deliberately animating nothing, the
 * handoff is invisible: it looks like one screen that simply stays put until
 * the app is ready.
 *
 * Server-rendered (no 'use client') so it paints before hydration, and the mark
 * is inline SVG rather than <img src="/icon.svg"> so it costs no request and
 * cannot flash in late — the one thing a launch screen must never do.
 */

/** The installed app icon's artwork, inlined. Mirrors public/icon.svg. */
function SplashMark() {
  return (
    <svg width="104" height="104" viewBox="0 0 512 512" role="img" aria-label="Pocketverse">
      <defs>
        <radialGradient id="pv-splash-bg" cx="50%" cy="42%" r="72%">
          <stop offset="0%" stopColor="#161d3a" />
          <stop offset="60%" stopColor="#0a1022" />
          <stop offset="100%" stopColor="#070b16" />
        </radialGradient>
        <linearGradient id="pv-splash-ring" x1="14%" y1="18%" x2="88%" y2="86%">
          <stop offset="0%" stopColor="#6d6af8" />
          <stop offset="55%" stopColor="#9d6af8" />
          <stop offset="100%" stopColor="#4fd1c5" />
        </linearGradient>
        <radialGradient id="pv-splash-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#eef0ff" />
          <stop offset="70%" stopColor="#b9b6ff" />
          <stop offset="100%" stopColor="#8f8bf6" />
        </radialGradient>
        <filter id="pv-splash-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="18" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#pv-splash-bg)" />
      <g transform="translate(256 256)" filter="url(#pv-splash-glow)">
        <ellipse
          rx="182"
          ry="80"
          transform="rotate(-24)"
          fill="none"
          stroke="url(#pv-splash-ring)"
          strokeWidth="15"
        />
        <circle cx="118" cy="-96" r="26" fill="#4fd1c5" />
        <circle r="52" fill="url(#pv-splash-core)" />
      </g>
    </svg>
  );
}

export function AppSplash({ label }: { label?: string }) {
  return (
    <div className="pv-splash" role="status" aria-live="polite">
      <SplashMark />
      <span className="pv-splash-name">Pocketverse</span>
      <span className="pv-splash-hint">{label ?? 'Opening your universe…'}</span>
    </div>
  );
}
