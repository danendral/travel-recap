import { ImageResponse } from "next/og";

export const alt = "Routelapse — animated travel map route video maker";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// A dark map-like canvas with a glowing route arc and a vehicle marker —
// mirrors the product (animated route revealed up to a moving vehicle).
export default function Image() {
  // Route control points (in the 1200x630 frame), drawn as a polyline of dots
  // with a brighter "revealed" head, evoking the reveal-gradient trail.
  const pts = [
    [120, 470],
    [250, 360],
    [400, 410],
    [560, 250],
    [720, 300],
    [880, 170],
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background:
            "radial-gradient(1200px 600px at 80% 0%, #15233f 0%, #0b1120 55%, #070b14 100%)",
          color: "#ffffff",
          fontFamily: "Arial, sans-serif",
          position: "relative",
        }}
      >
        {/* Route trail: dotted polyline + glowing head + vehicle */}
        <div style={{ position: "absolute", inset: 0, display: "flex" }}>
          {pts.map(([x, y], i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x - 7,
                top: y - 7,
                width: 14,
                height: 14,
                borderRadius: 999,
                background: i >= pts.length - 2 ? "#38bdf8" : "#1e3a5f",
                boxShadow:
                  i >= pts.length - 2 ? "0 0 24px 6px #38bdf8aa" : "none",
              }}
            />
          ))}
          {/* vehicle marker at the head of the revealed route */}
          <div
            style={{
              position: "absolute",
              left: pts[pts.length - 1][0] - 26,
              top: pts[pts.length - 1][1] - 26,
              width: 52,
              height: 52,
              borderRadius: 999,
              background: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 40px 10px #ffffff55",
              fontSize: 30,
            }}
          >
            ✈
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            color: "#7dd3fc",
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: 2,
          }}
        >
          ROUTELAPSE.COM
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 760 }}>
          <div style={{ fontSize: 76, fontWeight: 900, lineHeight: 1.02 }}>
            Animate your trip into a map route video.
          </div>
          <div style={{ fontSize: 32, fontWeight: 600, color: "#9fb3cc", lineHeight: 1.3 }}>
            Plot a route, watch the camera fly it, export an MP4 for Reels, TikTok
            &amp; Shorts. Free. No signup. Runs in your browser.
          </div>
        </div>
      </div>
    ),
    size
  );
}
