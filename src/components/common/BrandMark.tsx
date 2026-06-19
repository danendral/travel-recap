/**
 * Travel Recap wordmark + mark. A small inline-SVG globe-with-route glyph (a
 * cleaner, on-brand mark than the raw 🌍 emoji) next to the name. Used in the
 * editor header and the dashboard.
 */
export default function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" stroke="#38bdf8" strokeWidth="1.6" />
        {/* a dashed route arc across the globe — echoes the in-app trail */}
        <path
          d="M4 14c4-1 6-7 10-7"
          stroke="#7dd3fc"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray="2.4 2.4"
        />
        <circle cx="4" cy="14" r="1.7" fill="#0ea5e9" />
        <circle cx="14" cy="7" r="1.7" fill="#0ea5e9" />
      </svg>
      <span className="text-sm font-semibold tracking-tight text-slate-100">
        Travel Recap
      </span>
    </span>
  );
}
