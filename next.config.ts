import type { NextConfig } from "next";

// NOTE: We intentionally do NOT set COOP/COEP cross-origin-isolation headers.
//
// COEP `require-corp` blocks any cross-origin subresource that lacks a
// `Cross-Origin-Resource-Policy` header — and our map tiles
// (tile.openstreetmap.org), glyph fonts (fonts.openmaptiles.org), and the
// Photon geocoder do NOT send CORP. Enabling COEP therefore yields a blank map.
//
// The primary export path (WebCodecs `VideoEncoder` + Mediabunny mux) does NOT
// require cross-origin isolation. Only the threaded ffmpeg.wasm *fallback*
// does. When we wire that fallback up (Slice 6), we'll either serve its core
// same-origin or proxy the third-party map assets through a same-origin route,
// and re-enable these headers then.
const nextConfig: NextConfig = {};

export default nextConfig;
