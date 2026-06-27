import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// Brand favicon: a sky-blue paper plane on a transparent background — the
// "fly the route" theme, legible down to 16px. Rendered at 64px for crisp
// downscaling.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
          {/* dark outline so the plane stays visible on light tab strips */}
          <path
            d="M22 2 2 10.5l7.2 2.6L22 2Z"
            fill="#7dd3fc"
            stroke="#0b1120"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
          <path
            d="M22 2 9.2 13.1l.6 7.4 3.4-4.7L22 2Z"
            fill="#38bdf8"
            stroke="#0b1120"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    size
  );
}
