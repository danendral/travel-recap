import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Brand favicon: dark navy tile with a glowing sky-blue route arc and a head
// node — a tiny echo of the OG image and the in-app reveal-gradient trail.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background:
            "radial-gradient(20px 20px at 70% 10%, #15233f 0%, #0b1120 60%, #070b14 100%)",
          borderRadius: 6,
          position: "relative",
        }}
      >
        {/* tail node */}
        <div
          style={{
            position: "absolute",
            left: 5,
            top: 21,
            width: 5,
            height: 5,
            borderRadius: 999,
            background: "#1e3a5f",
          }}
        />
        {/* mid node */}
        <div
          style={{
            position: "absolute",
            left: 13,
            top: 14,
            width: 5,
            height: 5,
            borderRadius: 999,
            background: "#1e3a5f",
          }}
        />
        {/* glowing head node */}
        <div
          style={{
            position: "absolute",
            left: 21,
            top: 6,
            width: 7,
            height: 7,
            borderRadius: 999,
            background: "#38bdf8",
            boxShadow: "0 0 6px 2px #38bdf8aa",
          }}
        />
      </div>
    ),
    size
  );
}
