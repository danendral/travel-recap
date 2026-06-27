import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// Brand favicon: dark navy tile with a sky-blue paper plane — the "fly the
// route" theme, legible down to 16px. Rendered at 64px for crisp downscaling.
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
          background:
            "radial-gradient(40px 40px at 70% 10%, #15233f 0%, #0b1120 60%, #070b14 100%)",
          borderRadius: 12,
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
          {/* paper plane: body + folded wing crease */}
          <path d="M22 2 2 10.5l7.2 2.6L22 2Z" fill="#7dd3fc" />
          <path d="M22 2 9.2 13.1l.6 7.4 3.4-4.7L22 2Z" fill="#38bdf8" />
        </svg>
      </div>
    ),
    size
  );
}
